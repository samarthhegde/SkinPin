"""
PrivateCare V2 training pipeline.

This script adds:
1) A gate model for skin/non-skin and quality filtering.
2) A stronger condition model with augmentation and fine-tuning.
3) Exported TFLite models for mobile inference.

Backbone: MobileNetV2 (ImageNet pretrained)
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Dict

import tensorflow as tf


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "ml" / "artifacts_v2"
ARTIFACTS.mkdir(parents=True, exist_ok=True)

IMG_SIZE = (224, 224)
BATCH_SIZE = 32
SEED = 42

REDUCED_CLASS_MAP = {
    "Acne and Rosacea Photos": "inflammatory",
    "Actinic Keratosis Basal Cell Carcinoma and other Malignant Lesions": "malignant_or_precancerous",
    "Atopic Dermatitis Photos": "eczema_dermatitis",
    "Bullous Disease Photos": "autoimmune_bullous",
    "Cellulitis Impetigo and other Bacterial Infections": "infectious_bacterial",
    "Eczema Photos": "eczema_dermatitis",
    "Exanthems and Drug Eruptions": "inflammatory",
    "Hair Loss Photos Alopecia and other Hair Diseases": "hair_nail_disorder",
    "Herpes HPV and other STDs Photos": "infectious_viral_std",
    "Light Diseases and Disorders of Pigmentation": "pigment_light_disorder",
    "Lupus and other Connective Tissue diseases": "autoimmune_connective",
    "Melanoma Skin Cancer Nevi and Moles": "malignant_or_precancerous",
    "Nail Fungus and other Nail Disease": "hair_nail_disorder",
    "Poison Ivy Photos and other Contact Dermatitis": "eczema_dermatitis",
    "Psoriasis pictures Lichen Planus and related diseases": "papulosquamous",
    "Scabies Lyme Disease and other Infestations and Bites": "infestation_bite",
    "Seborrheic Keratoses and other Benign Tumors": "benign_tumor",
    "Systemic Disease": "systemic_manifestation",
    "Tinea Ringworm Candidiasis and other Fungal Infections": "infectious_fungal",
    "Urticaria Hives": "inflammatory",
    "Vascular Tumors": "vascular",
    "Vasculitis Photos": "vascular",
    "Warts Molluscum and other Viral Infections": "infectious_viral_std",
}


def get_callbacks(name: str):
    return [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=4, restore_best_weights=True
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.3, patience=2, min_lr=1e-6
        ),
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(ARTIFACTS / f"{name}.keras"),
            monitor="val_loss",
            save_best_only=True,
        ),
    ]


def categorical_focal_loss(alpha: float = 0.5, gamma: float = 2.0):
    def loss_fn(y_true, y_pred):
        y_pred = tf.clip_by_value(y_pred, 1e-7, 1.0 - 1e-7)
        ce = -y_true * tf.math.log(y_pred)
        modulation = tf.pow(1.0 - y_pred, gamma)
        return tf.reduce_sum(alpha * modulation * ce, axis=-1)

    return loss_fn


def compute_class_weights_from_counts(counts: list[int]) -> Dict[int, float]:
    safe_counts = [max(1, c) for c in counts]
    total = float(sum(safe_counts))
    num_classes = float(len(safe_counts))
    raw_weights = [total / (num_classes * c) for c in safe_counts]
    max_weight = max(raw_weights)
    normalized = [max(0.5, min(3.0, w / max_weight * 3.0)) for w in raw_weights]
    return {idx: weight for idx, weight in enumerate(normalized)}


def compute_class_weights(train_dir: Path, class_names: list[str]) -> Dict[int, float]:
    counts = []
    for class_name in class_names:
        class_dir = train_dir / class_name
        count = sum(1 for path in class_dir.rglob("*") if path.is_file())
        counts.append(max(1, count))

    return compute_class_weights_from_counts(counts)


def compute_reduced_class_weights(
    train_dir: Path,
    class_names: list[str],
    group_names: list[str],
) -> Dict[int, float]:
    grouped_counts: Dict[str, int] = {name: 0 for name in group_names}
    for class_name in class_names:
        class_dir = train_dir / class_name
        count = sum(1 for path in class_dir.rglob("*") if path.is_file())
        group_name = REDUCED_CLASS_MAP.get(class_name)
        if group_name is None:
            raise ValueError(f"Missing reduced-class mapping for: {class_name}")
        grouped_counts[group_name] += count

    counts = [max(1, grouped_counts[name]) for name in group_names]
    return compute_class_weights_from_counts(counts)


def make_reduced_label_transform(class_names: list[str], group_names: list[str]):
    group_to_idx = {group: i for i, group in enumerate(group_names)}
    matrix = []
    for class_name in class_names:
        group_name = REDUCED_CLASS_MAP.get(class_name)
        if group_name is None:
            raise ValueError(f"Missing reduced-class mapping for: {class_name}")
        row = [0.0] * len(group_names)
        row[group_to_idx[group_name]] = 1.0
        matrix.append(row)

    transform = tf.constant(matrix, dtype=tf.float32)

    def _map(x, y):
        return x, tf.matmul(y, transform)

    return _map


def make_quality_filter(min_stddev: float, min_brightness: float, max_brightness: float):
    min_stddev = tf.constant(min_stddev, dtype=tf.float32)
    min_brightness = tf.constant(min_brightness, dtype=tf.float32)
    max_brightness = tf.constant(max_brightness, dtype=tf.float32)

    def _filter(image, label):
        # image is [H, W, 3] float32 in [0, 255] from image_dataset_from_directory.
        gray = tf.reduce_mean(image, axis=-1)
        brightness = tf.reduce_mean(gray)
        stddev = tf.math.reduce_std(gray)
        keep = tf.logical_and(
            tf.logical_and(brightness >= min_brightness, brightness <= max_brightness),
            stddev >= min_stddev,
        )
        return keep

    return _filter


def augmenter():
    return tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip("horizontal"),
            tf.keras.layers.RandomRotation(0.08),
            tf.keras.layers.RandomZoom(0.12),
            tf.keras.layers.RandomContrast(0.2),
            tf.keras.layers.RandomBrightness(0.15),
        ]
    )


def build_backbone(num_classes: int, output_activation: str):
    base = tf.keras.applications.MobileNetV2(
        include_top=False, weights="imagenet", input_shape=(224, 224, 3)
    )
    base.trainable = False

    inputs = tf.keras.Input(shape=(224, 224, 3))
    x = augmenter()(inputs)
    x = tf.keras.applications.mobilenet_v2.preprocess_input(x)
    x = base(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.35)(x)
    outputs = tf.keras.layers.Dense(num_classes, activation=output_activation)(x)
    model = tf.keras.Model(inputs, outputs)
    return model, base


def fine_tune(
    model: tf.keras.Model,
    base: tf.keras.Model,
    train_ds,
    val_ds,
    class_weight: Dict[int, float] | None,
    loss_fn,
    metrics,
    epochs: int,
):
    base.trainable = True
    for layer in base.layers[:-50]:
        layer.trainable = False

    model.compile(
        optimizer=tf.keras.optimizers.Adam(5e-5),
        loss=loss_fn,
        metrics=metrics,
    )
    model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=epochs,
        class_weight=class_weight,
        callbacks=get_callbacks("condition_model_finetune"),
        verbose=1,
    )


def export_tflite(model: tf.keras.Model, out_name: str):
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite = converter.convert()
    (ARTIFACTS / out_name).write_bytes(tflite)


def load_manifest_rows(
    manifest_path: Path,
    split: str,
    include_fair: bool,
    exclude_needs_review: bool,
):
    rows = []
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    with manifest_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if row.get("split") != split:
                continue
            if exclude_needs_review and row.get("needs_review") == "yes":
                continue
            quality = row.get("image_quality", "poor")
            if quality == "poor":
                continue
            if not include_fair and quality == "fair":
                continue
            if row.get("folder_label") not in REDUCED_CLASS_MAP:
                continue
            rows.append(row)
    if not rows:
        raise ValueError(f"No usable manifest rows found for split='{split}'.")
    return rows


def build_dataset_from_manifest_rows(
    rows: list[dict[str, str]],
    class_names: list[str],
    reduced_classes: bool,
    shuffle: bool,
):
    class_to_idx = {name: idx for idx, name in enumerate(class_names)}
    if reduced_classes:
        output_names = []
        for name in class_names:
            reduced = REDUCED_CLASS_MAP[name]
            if reduced not in output_names:
                output_names.append(reduced)
        output_to_idx = {name: idx for idx, name in enumerate(output_names)}
    else:
        output_names = class_names

    image_paths = []
    label_ids = []
    for row in rows:
        folder_label = row["folder_label"]
        class_idx = class_to_idx[folder_label]
        if reduced_classes:
            reduced_name = REDUCED_CLASS_MAP[folder_label]
            label_idx = output_to_idx[reduced_name]
        else:
            label_idx = class_idx
        image_paths.append(str(ROOT / row["image_path"]))
        label_ids.append(label_idx)

    ds = tf.data.Dataset.from_tensor_slices(
        (tf.constant(image_paths), tf.constant(label_ids, dtype=tf.int32))
    )
    if shuffle:
        ds = ds.shuffle(min(len(image_paths), 8192), seed=SEED, reshuffle_each_iteration=True)

    num_outputs = len(output_names)

    def _load_and_encode(path, label):
        raw = tf.io.read_file(path)
        image = tf.image.decode_image(raw, channels=3, expand_animations=False)
        image = tf.image.resize(image, IMG_SIZE, method="bilinear")
        image = tf.cast(image, tf.float32)
        one_hot = tf.one_hot(label, depth=num_outputs, dtype=tf.float32)
        return image, one_hot

    ds = ds.map(_load_and_encode, num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

    counts = [0] * num_outputs
    for label in label_ids:
        counts[label] += 1
    class_weight = compute_class_weights_from_counts(counts)
    return ds, output_names, class_weight


def train_condition_model(
    reduced_classes: bool,
    min_stddev: float,
    min_brightness: float,
    max_brightness: float,
    manifest_path: Path,
    include_fair: bool,
    exclude_needs_review: bool,
):
    manifest_train_rows = load_manifest_rows(
        manifest_path=manifest_path,
        split="train",
        include_fair=include_fair,
        exclude_needs_review=exclude_needs_review,
    )
    manifest_val_rows = load_manifest_rows(
        manifest_path=manifest_path,
        split="test",
        include_fair=include_fair,
        exclude_needs_review=exclude_needs_review,
    )
    class_names = sorted(REDUCED_CLASS_MAP.keys())
    train_ds, output_names, class_weight = build_dataset_from_manifest_rows(
        rows=manifest_train_rows,
        class_names=class_names,
        reduced_classes=reduced_classes,
        shuffle=True,
    )
    val_ds, _, _ = build_dataset_from_manifest_rows(
        rows=manifest_val_rows,
        class_names=class_names,
        reduced_classes=reduced_classes,
        shuffle=False,
    )
    class_map = {str(i): label for i, label in enumerate(output_names)}
    print(f"Using class weights: {class_weight}")

    model, base = build_backbone(num_classes=len(output_names), output_activation="softmax")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(3e-4),
        loss=categorical_focal_loss(alpha=0.5, gamma=2.0),
        metrics=["accuracy"],
    )
    model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=16,
        class_weight=class_weight,
        callbacks=get_callbacks("condition_model"),
        verbose=1,
    )
    fine_tune(
        model,
        base,
        train_ds,
        val_ds,
        class_weight=class_weight,
        loss_fn=categorical_focal_loss(alpha=0.5, gamma=2.0),
        metrics=["accuracy"],
        epochs=8,
    )

    # Prefer Keras v3 format to avoid occasional HDF5 serialization edge cases.
    model.save(ARTIFACTS / "condition_model_final.keras")
    export_tflite(model, "condition_model.tflite")
    return class_map


def _binary_dataset(path: Path):
    train_ds = tf.keras.utils.image_dataset_from_directory(
        path,
        validation_split=0.2,
        subset="training",
        seed=SEED,
        label_mode="binary",
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
    )
    val_ds = tf.keras.utils.image_dataset_from_directory(
        path,
        validation_split=0.2,
        subset="validation",
        seed=SEED,
        label_mode="binary",
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
    )
    return train_ds.prefetch(tf.data.AUTOTUNE), val_ds.prefetch(tf.data.AUTOTUNE)


def train_binary_gate(dataset_path: Path, model_name: str):
    train_ds, val_ds = _binary_dataset(dataset_path)
    model, base = build_backbone(num_classes=1, output_activation="sigmoid")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc")],
    )
    model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=10,
        callbacks=get_callbacks(model_name),
        verbose=1,
    )
    fine_tune(
        model,
        base,
        train_ds,
        val_ds,
        class_weight=None,
        loss_fn="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc")],
        epochs=3,
    )
    model.save(ARTIFACTS / f"{model_name}_final.h5")
    export_tflite(model, f"{model_name}.tflite")


def train_gate_models() -> bool:
    gate_root = ROOT / "ml" / "datasets" / "gate"
    skin_non_skin = gate_root / "skin_non_skin"
    quality = gate_root / "quality"

    missing = [p for p in [skin_non_skin, quality] if not p.exists()]
    if missing:
        print(
            "Skipping gate training: missing datasets.\n"
            "Create directories to enable gate models:\n"
            "- ml/datasets/gate/skin_non_skin/{skin,non_skin}\n"
            "- ml/datasets/gate/quality/{good,poor}"
        )
        return False

    train_binary_gate(skin_non_skin, "skin_gate")
    train_binary_gate(quality, "quality_gate")
    return True


def write_metadata(
    condition_map: Dict[str, str],
    reduced_classes: bool,
    min_stddev: float,
    min_brightness: float,
    max_brightness: float,
    manifest_path: str,
    include_fair: bool,
    exclude_needs_review: bool,
):
    metadata = {
        "input_size": [224, 224, 3],
        "condition_threshold": 0.45,
        "margin_threshold": 0.10,
        "skin_gate_threshold": 0.5,
        "quality_gate_threshold": 0.5,
        "training_quality_filter": {
            "min_stddev": min_stddev,
            "min_brightness": min_brightness,
            "max_brightness": max_brightness,
        },
        "manifest_training": {
            "manifest_path": manifest_path,
            "include_fair": include_fair,
            "exclude_needs_review": exclude_needs_review,
        },
        "reduced_classes": reduced_classes,
        "condition_class_map": condition_map,
    }
    (ARTIFACTS / "metadata.json").write_text(json.dumps(metadata, indent=2))


def parse_args():
    parser = argparse.ArgumentParser(description="Train PrivateCare V2 models.")
    parser.add_argument(
        "--skip-gates",
        action="store_true",
        help="Skip skin/non-skin and quality gate training.",
    )
    parser.add_argument(
        "--reduced-classes",
        action="store_true",
        help="Train with merged superclasses to improve confidence.",
    )
    parser.add_argument(
        "--min-stddev",
        type=float,
        default=18.0,
        help="Minimum grayscale stddev to keep an image for training.",
    )
    parser.add_argument(
        "--min-brightness",
        type=float,
        default=35.0,
        help="Minimum grayscale mean brightness to keep an image for training.",
    )
    parser.add_argument(
        "--max-brightness",
        type=float,
        default=225.0,
        help="Maximum grayscale mean brightness to keep an image for training.",
    )
    parser.add_argument(
        "--manifest",
        type=str,
        default=str(ROOT / "ml" / "annotation" / "dataset_manifest.csv"),
        help="Manifest CSV path for manifest-driven training.",
    )
    parser.add_argument(
        "--exclude-needs-review",
        action="store_true",
        help="Exclude rows flagged as needs_review=yes in manifest.",
    )
    parser.add_argument(
        "--include-fair",
        action="store_true",
        help="Include image_quality=fair rows (poor rows are always excluded).",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    gate_trained = False
    if args.skip_gates:
        print("Skipping gate models by request (--skip-gates).")
    else:
        print("Training gate models...")
        gate_trained = train_gate_models()

    print("Training condition model...")
    class_map = train_condition_model(
        reduced_classes=args.reduced_classes,
        min_stddev=args.min_stddev,
        min_brightness=args.min_brightness,
        max_brightness=args.max_brightness,
        manifest_path=Path(args.manifest),
        include_fair=args.include_fair,
        exclude_needs_review=args.exclude_needs_review,
    )
    write_metadata(
        class_map,
        reduced_classes=args.reduced_classes,
        min_stddev=args.min_stddev,
        min_brightness=args.min_brightness,
        max_brightness=args.max_brightness,
        manifest_path=args.manifest,
        include_fair=args.include_fair,
        exclude_needs_review=args.exclude_needs_review,
    )
    if not gate_trained:
        print("Note: only condition model was trained in this run.")
    print("Done. Saved to ml/artifacts_v2/")


if __name__ == "__main__":
    main()
