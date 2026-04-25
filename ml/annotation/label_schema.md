# PrivateCare Labeling Schema (V2)

Use this schema to improve generalization and edge-case behavior.

## Core labels

- `image_id`: unique file name or UUID
- `primary_condition`: one of the 23 classes, `normal_skin`, `non_skin`, or `uncertain`
- `severity`: `mild`, `moderate`, `severe`, `none`
- `urgency`: `monitor`, `soon`, `urgent`

## Quality and edge-case labels

- `is_skin`: `yes` / `no`
- `image_quality`: `good`, `blurry`, `dark`, `overexposed`, `partial_view`
- `occlusion_type`: `none`, `clothing`, `hair`, `shadow`, `bandage`, `other`
- `artifact_present`: `none`, `makeup`, `tattoo`, `jewelry`, `compression`

## Context labels

- `body_region`: `face`, `neck`, `torso`, `arm`, `hand`, `leg`, `foot`, `other`
- `skin_tone_group`: `very_light`, `light`, `medium`, `tan`, `brown`, `dark`, `very_dark`, `unknown`

## Annotation confidence

- `annotator_confidence`: integer 1-5
- `label_source`: `expert`, `student`, `auto_bootstrap`, `consensus_review`
- `notes`: free-text for ambiguity

## Rules

1. If image is clearly not skin, set:
   - `is_skin=no`
   - `primary_condition=non_skin`
2. If image quality blocks diagnosis, set:
   - `primary_condition=uncertain`
   - quality + occlusion labels accurately
3. If no pathology visible and quality is good:
   - `primary_condition=normal_skin`
   - `severity=none`
   - `urgency=monitor`

## Why this helps

- Enables a **gate model** (`skin/non_skin` and `quality good/bad`)
- Enables uncertainty-aware abstain behavior
- Reduces false positives from clothing/background edge cases
