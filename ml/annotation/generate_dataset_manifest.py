"""
Generate a clear labeling manifest for local datasets.

The script scans archive folders and writes one CSV row per image with:
- inferred class label from folder name
- inferred split (train/test/unspecified)
- inferred superclass label
- lightweight quality metrics for review
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Iterable

import tensorflow as tf  # type: ignore[import-not-found]


ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = ROOT.parent

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

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

HAM_DX_TO_SUPER = {
    "akiec": "malignant_or_precancerous",
    "bcc": "malignant_or_precancerous",
    "bkl": "benign_tumor",
    "df": "benign_tumor",
    "mel": "malignant_or_precancerous",
    "nv": "benign_tumor",
    "vasc": "vascular",
}


def iter_images(root: Path) -> Iterable[Path]:
    if not root.exists():
        return []
    return (
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def infer_split(path: Path) -> str:
    lowered_parts = [part.lower() for part in path.parts]
    if "train" in lowered_parts:
        return "train"
    if "test" in lowered_parts or "val" in lowered_parts or "validation" in lowered_parts:
        return "test"
    if "ham10000_images_part_1" in lowered_parts or "ham10000_images_part_2" in lowered_parts:
        return "ham10000"
    return "unspecified"


def infer_folder_label(path: Path, dataset_root: Path) -> str:
    rel = path.relative_to(dataset_root)
    parts = list(rel.parts)
    if not parts:
        return "unknown"
    if parts[0].lower() in {"train", "test", "val", "validation"} and len(parts) > 1:
        return parts[1]
    return parts[0]


def infer_default_split(path: Path) -> str:
    digest = hashlib.md5(str(path).encode("utf-8")).hexdigest()
    bucket = int(digest[:2], 16) % 10
    return "train" if bucket < 8 else "test"


def quality_metrics(path: Path) -> tuple[float, float, int, int]:
    raw = tf.io.read_file(str(path))
    image = tf.image.decode_image(raw, channels=3, expand_animations=False)
    height = int(tf.shape(image)[0].numpy())
    width = int(tf.shape(image)[1].numpy())
    image = tf.image.resize(image, (128, 128), method="area")
    image = tf.cast(image, tf.float32)
    gray = tf.reduce_mean(image, axis=-1)
    brightness = float(tf.reduce_mean(gray).numpy())
    contrast = float(tf.math.reduce_std(gray).numpy())
    return brightness, contrast, width, height


def quality_bucket(brightness: float, contrast: float, width: int, height: int) -> str:
    if width < 160 or height < 160:
        return "poor"
    if brightness < 35 or brightness > 225:
        return "poor"
    if contrast < 18:
        return "poor"
    if brightness < 55 or brightness > 205 or contrast < 26:
        return "fair"
    return "good"


def parse_args():
    parser = argparse.ArgumentParser(description="Generate dataset label manifest CSV.")
    parser.add_argument(
        "--datasets",
        nargs="*",
        default=["archive", "archive (1)", "../archive (3)"],
        help="Dataset directories relative to app root.",
    )
    parser.add_argument(
        "--normal-skin-datasets",
        nargs="*",
        default=["../archive (3)", "archive (3)"],
        help="Datasets that should be force-labeled as normal_skin.",
    )
    parser.add_argument(
        "--out",
        default="ml/annotation/dataset_manifest.csv",
        help="Output CSV path relative to app root.",
    )
    parser.add_argument(
        "--review-out",
        default="ml/annotation/dataset_review_queue.csv",
        help="Output CSV path for rows needing manual review.",
    )
    parser.add_argument(
        "--report-out",
        default="ml/annotation/dataset_labeling_report.json",
        help="Output JSON path for labeling completion report.",
    )
    return parser.parse_args()


def load_ham10000_labels(metadata_csv: Path) -> dict[str, str]:
    labels: dict[str, str] = {}
    if not metadata_csv.exists():
        return labels
    with metadata_csv.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            image_id = (row.get("image_id") or "").strip()
            dx = (row.get("dx") or "").strip()
            if image_id and dx:
                labels[image_id] = dx
    return labels


def main():
    args = parse_args()
    output_path = ROOT / args.out
    review_path = ROOT / args.review_out
    report_path = ROOT / args.report_out
    output_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    ham_labels = load_ham10000_labels(ROOT / "archive" / "HAM10000_metadata.csv")
    normal_skin_datasets = {
        name.strip().lower().rstrip("/\\") for name in args.normal_skin_datasets if name.strip()
    }

    rows = []
    for dataset_name in args.datasets:
        dataset_name_clean = dataset_name.strip()
        dataset_name_key = dataset_name_clean.lower().rstrip("/\\")
        dataset_root = Path(dataset_name_clean)
        if not dataset_root.is_absolute():
            dataset_root = (ROOT / dataset_root).resolve()
        is_normal_skin_dataset = dataset_name_key in normal_skin_datasets
        for idx, image_path in enumerate(iter_images(dataset_root), start=1):
            try:
                brightness, contrast, width, height = quality_metrics(image_path)
            except Exception:
                # Keep problematic files visible in the manifest for review.
                brightness, contrast, width, height = 0.0, 0.0, 0, 0

            folder_label = infer_folder_label(image_path, dataset_root)
            label = folder_label
            label_source = "folder_inference"
            if is_normal_skin_dataset:
                label = "normal_skin"
                label_source = "dataset_override_normal_skin"
                super_label = "normal_skin"
            else:
                if dataset_name_key == "archive" and folder_label.lower().startswith("ham10000_images_part_"):
                    image_id = image_path.stem
                    mapped_dx = ham_labels.get(image_id)
                    if mapped_dx:
                        label = mapped_dx
                        label_source = "ham10000_metadata"

                if label_source == "ham10000_metadata":
                    super_label = HAM_DX_TO_SUPER.get(label, "unmapped")
                else:
                    super_label = REDUCED_CLASS_MAP.get(label, "unmapped")

            try:
                rel_path = image_path.relative_to(ROOT)
            except ValueError:
                rel_path = Path("..") / image_path.relative_to(WORKSPACE_ROOT)

            split = infer_split(image_path)
            if is_normal_skin_dataset and split == "unspecified":
                split = infer_default_split(image_path)

            rows.append(
                {
                    "image_path": str(rel_path),
                    "dataset_source": dataset_name_clean,
                    "split": split,
                    "folder_label": label,
                    "super_label": super_label,
                    "is_skin": "yes",
                    "image_quality": quality_bucket(brightness, contrast, width, height),
                    "brightness_mean": f"{brightness:.2f}",
                    "contrast_std": f"{contrast:.2f}",
                    "width": width,
                    "height": height,
                    "needs_review": "yes" if super_label == "unmapped" else "no",
                    "label_source": label_source,
                    "label_status": "auto_complete",
                    "human_verified": "no",
                }
            )
            if idx % 1000 == 0:
                print(f"[{dataset_name}] indexed {idx} images...")

    rows.sort(key=lambda row: row["image_path"])
    fieldnames = [
        "image_path",
        "dataset_source",
        "split",
        "folder_label",
        "super_label",
        "is_skin",
        "image_quality",
        "brightness_mean",
        "contrast_std",
        "width",
        "height",
        "needs_review",
        "label_source",
        "label_status",
        "human_verified",
    ]
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    review_rows = [
        row
        for row in rows
        if row["needs_review"] == "yes" or row["image_quality"] in {"poor", "fair"}
    ]
    with review_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(review_rows)

    quality_counts = Counter(row["image_quality"] for row in rows)
    split_counts = Counter(row["split"] for row in rows)
    super_counts = Counter(row["super_label"] for row in rows)
    unmapped_count = sum(1 for row in rows if row["super_label"] == "unmapped")
    report = {
        "total_rows": len(rows),
        "review_queue_rows": len(review_rows),
        "unmapped_rows": unmapped_count,
        "is_fully_labeled_structurally": unmapped_count == 0,
        "quality_counts": dict(sorted(quality_counts.items())),
        "split_counts": dict(sorted(split_counts.items())),
        "super_label_counts": dict(sorted(super_counts.items())),
    }
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"Wrote {len(rows)} rows to {output_path}")
    print(f"Wrote {len(review_rows)} review rows to {review_path}")
    print(f"Wrote labeling report to {report_path}")


if __name__ == "__main__":
    main()
