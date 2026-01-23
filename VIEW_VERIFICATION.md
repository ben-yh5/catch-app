# View Verification System - Implementation Instructions

## Goal
Build a hybrid image verification system that determines if two photos show the same view (location + angle), robust to lighting/seasonal changes.

## Architecture

**Pipeline:**
```
1. Metadata pre-filter (GPS/heading/pitch thresholds)
2. Image quality check (brightness, blur detection)
3. Feature matching with ORB (fast path)
   - >30 matches → TRUE
   - <10 matches → FALSE
   - 10-30 matches → proceed to step 4
4. Siamese neural network (ML verification for ambiguous cases)
```

## Implementation Tasks

### 1. Core Verification Module
Create `view_verifier.py` with:
- Metadata filtering (distance, heading, pitch thresholds)
- Image quality checks (reject if mean brightness < 30, blur variance < 100)
- ORB feature matching with RANSAC geometric verification
- Siamese network integration (loads pretrained model)
- Main `verify(img1, img2, meta1, meta2)` function returning (bool, confidence_score)

### 2. Siamese Network
Create `model.py` with:
- MobileNetV3-Small backbone (pretrained on ImageNet)
- Feature extractor (576-dim → 128-dim projection)
- Comparison head: concatenate embeddings → FC layers → sigmoid output
- Input: 224x224 RGB images
- Output: similarity score 0-1

### 3. Training Script
Create `train.py`:
- Dataset loader for image pairs (positive/negative examples)
- Data augmentation: brightness (±50%), contrast, color jitter, rotation (±15°)
- Binary cross-entropy loss
- Adam optimizer, learning rate 1e-4
- Train/val split 80/20
- Save best model based on validation accuracy

### 4. Data Requirements
Need labeled pairs:
- **Positives (50%)**: Same view, varying conditions (lighting, seasons, weather)
- **Negatives (50%)**: Different views, especially hard negatives (similar GPS, different angle)
- Minimum: 10K pairs (5K positive, 5K negative)
- Store as: `data/pairs.csv` with columns: img1_path, img2_path, label, lat1, lon1, heading1, pitch1, lat2, lon2, heading2, pitch2

### 5. Utilities
Create `utils.py`:
- Image preprocessing (resize to 224x224, normalize)
- Metadata distance calculations (haversine for GPS, angle differences)
- Evaluation metrics (accuracy, precision, recall, F1)

### 6. Mobile Export
Create `export_model.py`:
- Convert PyTorch model to TorchScript or ONNX
- Quantize to INT8 for mobile deployment
- Target: <10MB model size

## Key Parameters to Tune
- Metadata thresholds: distance_m=50, heading_deg=30, pitch_deg=20
- Feature match thresholds: confident=30, reject=10
- ML threshold: 0.7 (adjust based on precision/recall tradeoff)
- Brightness reject: <30 (too dark)

## Testing Strategy
1. Unit tests for each component
2. Integration test with sample image pairs
3. Benchmark on validation set (report accuracy, precision, recall)
4. Measure inference time (target: <100ms on mobile)

## Project Structure
```
view-verification/
├── model.py
├── view_verifier.py
├── train.py
├── utils.py
├── export_model.py
├── data/
│   └── pairs.csv
├── models/
│   └── best_model.pth
└── tests/
    └── test_verifier.py
```

## Dependencies
```
opencv-python
torch
torchvision
numpy
pandas
pillow
scikit-learn
```

## Performance Expectations
- Easy cases (90%): Feature matching handles it (10-50ms)
- Hard cases (10%): ML verification needed (50-150ms)
- Expected accuracy: 85-95% depending on training data quality