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

For the robust 2-stage pipeline (gate + condition + abstain metadata, pretrained MobileNetV2 backbone):

```bash
python ml/train_privatecare_v2.py
```

For a more confident, reduced-class condition model:

```bash
python ml/train_privatecare_v2.py --reduced-classes
```

If you have not prepared gate datasets yet, train the condition model only:

```bash
python ml/train_privatecare_v2.py --skip-gates
```

You can combine both for fastest hackathon run:

```bash
python ml/train_privatecare_v2.py --skip-gates --reduced-classes
```

## Output artifacts

Generated under `ml/artifacts/`:

- `ham10000_keras.h5`
- `ham10000_tflite.tflite`
- `derma23_keras.h5`
- `derma23_tflite.tflite`
- `class_maps.json`

Generated under `ml/artifacts_v2/`:

- `skin_gate.tflite` (`skin` vs `non_skin`)
- `quality_gate.tflite` (`good` vs `poor`)
- `condition_model.tflite` (23-class condition prediction)
- `metadata.json` (thresholds and class mapping)

## V2 gate datasets

Before running `train_privatecare_v2.py`, create:

- `ml/datasets/gate/skin_non_skin/skin`
- `ml/datasets/gate/skin_non_skin/non_skin`
- `ml/datasets/gate/quality/good`
- `ml/datasets/gate/quality/poor`

Use `ml/annotation/label_schema.md` and `ml/annotation/annotation_template.csv` to build consistent labels.

## Notes for hackathon demo

- Start with this baseline training pipeline for credibility and reproducibility.
- For production-level results, add:
  - stronger augmentation
  - class balancing / focal loss
  - calibration and uncertainty thresholds
  - held-out validation metrics and confusion matrix
