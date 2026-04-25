"""
Calibrate confidence/margin thresholds for safer holdout performance.

This script:
1) Evaluates model predictions on manifest-driven holdout rows.
2) Reports top-1/top-3 and per-class accuracy.
3) Grid-searches confidence + margin thresholds.
4) Optionally writes the best thresholds into artifacts_v2/metadata.json.
"""

from __future__ import annotations

import argparse
import csv
import json
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


def parse_args():
    parser = argparse.ArgumentParser(description="Calibrate PrivateCare V2 thresholds.")
    parser.add_argument(
        "--model",
        default=str(ARTIFACTS / "condition_model_final.keras"),
        help="Path to trained Keras model.",
    )
    parser.add_argument(
        "--manifest",
        default=str(ROOT / "ml" / "annotation" / "dataset_manifest.csv"),
        help="Manifest CSV used for holdout selection.",
    )
    parser.add_argument(
        "--write-metadata",
        action="store_true",
        help="Write best thresholds to artifacts_v2/metadata.json.",
    )
    return parser.parse_args()


def load_holdout_rows(manifest_path: Path, include_fair: bool, exclude_needs_review: bool):
    rows = []
    with manifest_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if row.get("split") != "test":
                continue
            if row.get("folder_label") not in REDUCED_CLASS_MAP:
                continue
            if exclude_needs_review and row.get("needs_review") == "yes":
                continue
            quality = row.get("image_quality", "poor")
            if quality == "poor":
                continue
            if not include_fair and quality == "fair":
                continue
            rows.append(row)
    if not rows:
        raise ValueError("No holdout rows selected from manifest.")
    return rows


def build_holdout_dataset(rows: list[dict[str, str]], output_names: list[str]):
    output_to_idx = {name: i for i, name in enumerate(output_names)}
    image_paths = []
    label_ids = []
    for row in rows:
        reduced = REDUCED_CLASS_MAP[row["folder_label"]]
        image_paths.append(str(ROOT / row["image_path"]))
        label_ids.append(output_to_idx[reduced])

    ds = tf.data.Dataset.from_tensor_slices(
        (tf.constant(image_paths), tf.constant(label_ids, dtype=tf.int32))
    )

    def _load(path, label):
        raw = tf.io.read_file(path)
        image = tf.image.decode_image(raw, channels=3, expand_animations=False)
        image = tf.image.resize(image, IMG_SIZE, method="bilinear")
        image = tf.cast(image, tf.float32)
        one_hot = tf.one_hot(label, depth=len(output_names), dtype=tf.float32)
        return image, one_hot

    return ds.map(_load, num_parallel_calls=tf.data.AUTOTUNE).batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)


def score_thresholds(y_true_idx: np.ndarray, y_prob: np.ndarray, conf_thr: float, margin_thr: float):
    pred_idx = np.argmax(y_prob, axis=1)
    sorted_prob = np.sort(y_prob, axis=1)[:, ::-1]
    conf = sorted_prob[:, 0]
    margin = conf - sorted_prob[:, 1]
    abstain = np.logical_or(conf < conf_thr, margin < margin_thr)
    covered = ~abstain
    if np.any(covered):
        covered_acc = float(np.mean(pred_idx[covered] == y_true_idx[covered]))
    else:
        covered_acc = 0.0
    abstain_rate = float(np.mean(abstain))
    # Weighted utility: reward covered accuracy, lightly penalize abstain.
    utility = covered_acc - 0.2 * abstain_rate
    return covered_acc, abstain_rate, utility


def main():
    args = parse_args()
    metadata_path = ARTIFACTS / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    include_fair = bool(metadata.get("manifest_training", {}).get("include_fair", True))
    exclude_needs_review = bool(
        metadata.get("manifest_training", {}).get("exclude_needs_review", True)
    )
    output_names = [metadata["condition_class_map"][str(i)] for i in range(len(metadata["condition_class_map"]))]

    holdout_rows = load_holdout_rows(
        manifest_path=Path(args.manifest),
        include_fair=include_fair,
        exclude_needs_review=exclude_needs_review,
    )
    ds = build_holdout_dataset(holdout_rows, output_names)
    model = tf.keras.models.load_model(args.model, compile=False)

    y_true_parts = []
    y_prob_parts = []
    for xb, yb in ds:
        y_prob_parts.append(model(xb, training=False).numpy())
        y_true_parts.append(yb.numpy())
    y_true = np.concatenate(y_true_parts, axis=0)
    y_prob = np.concatenate(y_prob_parts, axis=0)
    y_true_idx = np.argmax(y_true, axis=1)
    y_pred_idx = np.argmax(y_prob, axis=1)

    top1 = float(np.mean(y_pred_idx == y_true_idx))
    top3_idx = np.argsort(y_prob, axis=1)[:, ::-1][:, :3]
    top3 = float(np.mean(np.any(top3_idx == y_true_idx[:, None], axis=1)))

    per_class = {}
    for idx, name in enumerate(output_names):
        mask = y_true_idx == idx
        if np.any(mask):
            per_class[name] = float(np.mean(y_pred_idx[mask] == y_true_idx[mask]))

    best = None
    for conf in np.arange(0.35, 0.76, 0.05):
        for margin in np.arange(0.05, 0.26, 0.025):
            covered_acc, abstain_rate, utility = score_thresholds(
                y_true_idx, y_prob, float(conf), float(margin)
            )
            candidate = {
                "confidence_threshold": float(round(conf, 3)),
                "margin_threshold": float(round(margin, 3)),
                "covered_accuracy": covered_acc,
                "abstain_rate": abstain_rate,
                "utility": utility,
            }
            if best is None or candidate["utility"] > best["utility"]:
                best = candidate

    print("Calibration complete")
    print(f"holdout_samples: {len(y_true_idx)}")
    print(f"top1_accuracy: {top1:.4f}")
    print(f"top3_accuracy: {top3:.4f}")
    print("best_thresholds:")
    print(json.dumps(best, indent=2))
    print("per_class_top1:")
    print(json.dumps(per_class, indent=2))

    if args.write_metadata and best is not None:
        metadata["condition_threshold"] = best["confidence_threshold"]
        metadata["margin_threshold"] = best["margin_threshold"]
        metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        print(f"Updated thresholds in {metadata_path}")


if __name__ == "__main__":
    main()
