"""
Evaluate PrivateCare V2 condition model on holdout data.

Reports:
- top1 accuracy
- top3 accuracy
- abstain rate based on confidence + margin thresholds
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import tensorflow as tf


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "ml" / "artifacts_v2"
IMG_SIZE = (224, 224)
BATCH_SIZE = 32

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


def make_quality_filter(min_stddev: float, min_brightness: float, max_brightness: float):
    min_stddev = tf.constant(min_stddev, dtype=tf.float32)
    min_brightness = tf.constant(min_brightness, dtype=tf.float32)
    max_brightness = tf.constant(max_brightness, dtype=tf.float32)

    def _filter(image, label):
        gray = tf.reduce_mean(image, axis=-1)
        brightness = tf.reduce_mean(gray)
        stddev = tf.math.reduce_std(gray)
        return tf.logical_and(
            tf.logical_and(brightness >= min_brightness, brightness <= max_brightness),
            stddev >= min_stddev,
        )

    return _filter


def make_reduced_label_transform(class_names: list[str], output_names: list[str]):
    output_idx = {name: i for i, name in enumerate(output_names)}
    matrix = []
    for class_name in class_names:
        reduced = REDUCED_CLASS_MAP[class_name]
        row = [0.0] * len(output_names)
        row[output_idx[reduced]] = 1.0
        matrix.append(row)
    transform = tf.constant(matrix, dtype=tf.float32)

    def _map(x, y):
        return x, tf.matmul(y, transform)

    return _map


def parse_args():
    parser = argparse.ArgumentParser(description="Evaluate PrivateCare V2 condition model.")
    parser.add_argument(
        "--model",
        default=str(ARTIFACTS / "condition_model_final.keras"),
        help="Path to trained Keras model.",
    )
    parser.add_argument(
        "--topk",
        type=int,
        default=3,
        help="Top-K for recall metric.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    metadata = json.loads((ARTIFACTS / "metadata.json").read_text(encoding="utf-8"))
    reduced_classes = bool(metadata.get("reduced_classes", False))
    min_stddev = float(metadata["training_quality_filter"]["min_stddev"])
    min_brightness = float(metadata["training_quality_filter"]["min_brightness"])
    max_brightness = float(metadata["training_quality_filter"]["max_brightness"])
    threshold = float(metadata.get("condition_threshold", 0.45))
    margin = float(metadata.get("margin_threshold", 0.10))

    val_dir = ROOT / "archive (1)" / "test"
    val_ds = tf.keras.utils.image_dataset_from_directory(
        val_dir,
        label_mode="categorical",
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        shuffle=False,
    )
    class_names = val_ds.class_names
    output_names = class_names
    val_ds = val_ds.filter(make_quality_filter(min_stddev, min_brightness, max_brightness))
    if reduced_classes:
        output_names = []
        for name in class_names:
            reduced = REDUCED_CLASS_MAP[name]
            if reduced not in output_names:
                output_names.append(reduced)
        val_ds = val_ds.map(
            make_reduced_label_transform(class_names, output_names),
            num_parallel_calls=tf.data.AUTOTUNE,
        )

    model = tf.keras.models.load_model(args.model, compile=False)
    val_ds = val_ds.prefetch(tf.data.AUTOTUNE)

    y_true_parts = []
    y_prob_parts = []
    kept_samples = 0
    for xb, yb in val_ds:
        probs = model(xb, training=False).numpy()
        y_prob_parts.append(probs)
        y_true_parts.append(yb.numpy())
        kept_samples += int(xb.shape[0])

    y_true = np.concatenate(y_true_parts, axis=0)
    y_prob = np.concatenate(y_prob_parts, axis=0)
    true_idx = np.argmax(y_true, axis=1)
    pred_idx = np.argmax(y_prob, axis=1)

    top1 = float(np.mean(pred_idx == true_idx))
    k = min(args.topk, y_prob.shape[1])
    topk_idx = np.argsort(y_prob, axis=1)[:, ::-1][:, :k]
    topk = float(np.mean(np.any(topk_idx == true_idx[:, None], axis=1)))

    sorted_prob = np.sort(y_prob, axis=1)[:, ::-1]
    conf = sorted_prob[:, 0]
    marg = conf - sorted_prob[:, 1]
    abstain = np.logical_or(conf < threshold, marg < margin)
    abstain_rate = float(np.mean(abstain))

    print("Evaluation complete")
    print(f"kept_samples: {kept_samples}")
    print(f"num_classes: {len(output_names)}")
    print(f"top1_accuracy: {top1:.4f}")
    print(f"top{k}_accuracy: {topk:.4f}")
    print(f"abstain_rate: {abstain_rate:.4f}")
    print(f"thresholds: confidence={threshold:.2f}, margin={margin:.2f}")

    per_class_counts = defaultdict(int)
    per_class_correct = defaultdict(int)
    for i, idx in enumerate(true_idx):
        name = output_names[int(idx)]
        per_class_counts[name] += 1
        if pred_idx[i] == idx:
            per_class_correct[name] += 1
    print("per_class_top1:")
    for name in output_names:
        total = per_class_counts[name]
        if total == 0:
            continue
        acc = per_class_correct[name] / total
        print(f"  {name}: {acc:.4f} ({per_class_correct[name]}/{total})")


if __name__ == "__main__":
    main()
