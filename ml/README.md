# PrivateCare Model Training

This folder contains a practical training pipeline for both datasets in this repo:

- `archive/` (HAM10000 CSV pixel dataset)
- `archive (1)/` (23-class train/test image folders)

## What the script trains

`train_skin_models.py` trains two neural-network models:

1. **HAM10000 model (7 classes)**  
   Input: `archive/hmnist_28_28_RGB.csv`  
   Model: small CNN (fast baseline for skin lesion classes)

2. **Derma23 model (23 classes)**  
   Input: `archive (1)/train`, `archive (1)/test`  
   Model: EfficientNetB0 transfer learning (classification by condition category)

Both models are exported to Keras + TFLite for mobile inference integration.

## Setup

```bash
cd ml
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Train

Run from project root:

```bash
python ml/train_skin_models.py
```

## Output artifacts

Generated under `ml/artifacts/`:

- `ham10000_keras.h5`
- `ham10000_tflite.tflite`
- `derma23_keras.h5`
- `derma23_tflite.tflite`
- `class_maps.json`

## Notes for hackathon demo

- Start with this baseline training pipeline for credibility and reproducibility.
- For production-level results, add:
  - stronger augmentation
  - class balancing / focal loss
  - calibration and uncertainty thresholds
  - held-out validation metrics and confusion matrix
