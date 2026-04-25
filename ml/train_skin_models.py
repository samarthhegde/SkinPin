"""
PrivateCare training pipeline.

Trains two models:
1) HAM10000 classifier from hmnist_28_28_RGB.csv (7 classes)
2) Derma imagefolder classifier from archive (1)/train and /test (23 classes)

Exports:
- ham10000_keras.h5
- ham10000_tflite.tflite
- derma23_keras.h5
- derma23_tflite.tflite
- class_maps.json
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import pandas as pd
import tensorflow as tf


@dataclass
class TrainConfig:
    root: Path
    output_dir: Path
    epochs_ham: int = 10
    epochs_derma: int = 8
    batch_size: int = 32
    seed: int = 42


def build_small_cnn(num_classes: int, input_shape: Tuple[int, int, int]) -> tf.keras.Model:
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=input_shape),
            tf.keras.layers.Conv2D(32, 3, activation="relu"),
            tf.keras.layers.MaxPooling2D(),
            tf.keras.layers.Conv2D(64, 3, activation="relu"),
            tf.keras.layers.MaxPooling2D(),
            tf.keras.layers.Conv2D(128, 3, activation="relu"),
            tf.keras.layers.GlobalAveragePooling2D(),
            tf.keras.layers.Dropout(0.3),
            tf.keras.layers.Dense(128, activation="relu"),
            tf.keras.layers.Dense(num_classes, activation="softmax"),
        ]
    )
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def train_ham10000(cfg: TrainConfig) -> Tuple[tf.keras.Model, Dict[str, int]]:
    csv_path = cfg.root / "archive" / "hmnist_28_28_RGB.csv"
    df = pd.read_csv(csv_path)

    y = df["label"].values.astype(np.int32)
    x = df.drop(columns=["label"]).values.astype(np.float32) / 255.0
    x = x.reshape((-1, 28, 28, 3))

    model = build_small_cnn(num_classes=len(np.unique(y)), input_shape=(28, 28, 3))
    model.fit(
        x,
        y,
        validation_split=0.1,
        epochs=cfg.epochs_ham,
        batch_size=cfg.batch_size,
        verbose=1,
    )

    class_map = {
        "0": "akiec",
        "1": "bcc",
        "2": "bkl",
        "3": "df",
        "4": "nv",
        "5": "vasc",
        "6": "mel",
    }
    return model, class_map


def build_derma_model(num_classes: int) -> tf.keras.Model:
    base = tf.keras.applications.EfficientNetB0(
        include_top=False, input_shape=(224, 224, 3), weights="imagenet"
    )
    base.trainable = False

    inputs = tf.keras.Input(shape=(224, 224, 3))
    x = tf.keras.applications.efficientnet.preprocess_input(inputs)
    x = base(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.35)(x)
    outputs = tf.keras.layers.Dense(num_classes, activation="softmax")(x)
    model = tf.keras.Model(inputs, outputs)

    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def train_derma23(cfg: TrainConfig) -> Tuple[tf.keras.Model, Dict[str, int]]:
    train_dir = cfg.root / "archive (1)" / "train"
    test_dir = cfg.root / "archive (1)" / "test"

    train_ds = tf.keras.utils.image_dataset_from_directory(
        train_dir,
        label_mode="categorical",
        image_size=(224, 224),
        batch_size=cfg.batch_size,
        shuffle=True,
        seed=cfg.seed,
    )
    test_ds = tf.keras.utils.image_dataset_from_directory(
        test_dir,
        label_mode="categorical",
        image_size=(224, 224),
        batch_size=cfg.batch_size,
        shuffle=False,
    )

    class_names = train_ds.class_names
    class_map = {str(idx): name for idx, name in enumerate(class_names)}

    autotune = tf.data.AUTOTUNE
    train_ds = train_ds.prefetch(autotune)
    test_ds = test_ds.prefetch(autotune)

    model = build_derma_model(num_classes=len(class_names))
    model.fit(train_ds, validation_data=test_ds, epochs=cfg.epochs_derma, verbose=1)

    return model, class_map


def save_tflite(model: tf.keras.Model, path: Path) -> None:
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()
    path.write_bytes(tflite_model)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    output_dir = root / "ml" / "artifacts"
    output_dir.mkdir(parents=True, exist_ok=True)
    cfg = TrainConfig(root=root, output_dir=output_dir)

    print("Training HAM10000 model...")
    ham_model, ham_map = train_ham10000(cfg)
    ham_model.save(output_dir / "ham10000_keras.h5")
    save_tflite(ham_model, output_dir / "ham10000_tflite.tflite")

    print("Training Derma23 model...")
    derma_model, derma_map = train_derma23(cfg)
    derma_model.save(output_dir / "derma23_keras.h5")
    save_tflite(derma_model, output_dir / "derma23_tflite.tflite")

    class_maps = {"ham10000": ham_map, "derma23": derma_map}
    with open(output_dir / "class_maps.json", "w", encoding="utf-8") as f:
        json.dump(class_maps, f, indent=2)

    print(f"Done. Artifacts in {output_dir}")


if __name__ == "__main__":
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
    main()
