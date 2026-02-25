"""
Downloads a subset of Google Landmarks Dataset v2 (GLDv2) for base training.

GLDv2 images are distributed as tar archives (~1GB each). This script:
1. Downloads 1-2 tar files from S3
2. Extracts images
3. Cross-references with train_clean.csv to map images → landmarks
4. Organizes matched images into training_data/gldv2/{landmark_id}/
5. Resizes to 224x224 and cleans up raw files

Usage:
    python scripts/download_gldv2.py --tars 1
    python scripts/download_gldv2.py --tars 2 --max_landmarks 500
"""

import csv
import tarfile
import random
import argparse
import requests
import shutil
from pathlib import Path
from collections import defaultdict

try:
    from tqdm import tqdm
except ImportError:
    def tqdm(iterable, **kwargs):
        total = kwargs.get('total', None)
        desc = kwargs.get('desc', '')
        for i, item in enumerate(iterable):
            if total and i % max(total // 20, 1) == 0:
                print(f"  {desc} {i}/{total}")
            yield item

from PIL import Image

# URLs
GLDV2_CSV_URL = "https://s3.amazonaws.com/google-landmark/metadata/train_clean.csv"
GLDV2_TAR_URL = "https://s3.amazonaws.com/google-landmark/train/images_{:03d}.tar"

# Paths
DATA_DIR = Path("training_data")
GLDV2_DIR = DATA_DIR / "gldv2"
CSV_CACHE = DATA_DIR / "gldv2_train_clean.csv"
TAR_CACHE_DIR = DATA_DIR / "gldv2_tars"
EXTRACT_DIR = DATA_DIR / "gldv2_raw"

TARGET_SIZE = 224


def download_file(url, dest, label="file"):
    """Downloads a file with progress, skipping if already exists."""
    if dest.exists():
        print(f"  Using cached {label}: {dest}")
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  Downloading {label}...")
    print(f"  URL: {url}")

    response = requests.get(url, stream=True)
    response.raise_for_status()
    total_size = int(response.headers.get('content-length', 0))

    downloaded = 0
    with open(dest, 'wb') as f:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
            downloaded += len(chunk)
            if total_size:
                pct = downloaded / total_size * 100
                mb_down = downloaded // (1024 * 1024)
                mb_total = total_size // (1024 * 1024)
                # Print every ~10%
                if mb_down % max(mb_total // 10, 1) == 0:
                    print(f"    {mb_down}MB / {mb_total}MB ({pct:.0f}%)")

    print(f"  Saved to {dest}")
    return dest


def parse_clean_csv(csv_path):
    """
    Parses train_clean.csv → dict mapping image_id to landmark_id.
    CSV format: landmark_id,images (space-separated image IDs)
    """
    print(f"  Parsing train_clean.csv...")
    image_to_landmark = {}
    landmark_counts = defaultdict(int)

    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            landmark_id = row['landmark_id']
            image_ids = row['images'].strip().split()
            for img_id in image_ids:
                image_to_landmark[img_id] = landmark_id
                landmark_counts[landmark_id] += 1

    print(f"  {len(image_to_landmark)} images across {len(landmark_counts)} landmarks")
    return image_to_landmark, landmark_counts


def extract_tar(tar_path, extract_dir):
    """Extracts a tar file, returning list of extracted image paths."""
    extract_dir.mkdir(parents=True, exist_ok=True)
    print(f"  Extracting {tar_path.name}...")

    extracted = []
    with tarfile.open(tar_path, 'r') as tar:
        members = tar.getmembers()
        for member in tqdm(members, desc="Extracting", total=len(members)):
            if member.isfile() and member.name.endswith('.jpg'):
                tar.extract(member, extract_dir)
                extracted.append(extract_dir / member.name)

    print(f"  Extracted {len(extracted)} images")
    return extracted


def organize_images(extracted_paths, image_to_landmark, max_landmarks, images_per_landmark):
    """
    Moves extracted images into landmark folders, resizing along the way.
    Only keeps landmarks with 2+ images (needed for positive pairs).
    """
    print(f"  Organizing images by landmark...")

    # Map extracted images to their landmarks
    landmark_images = defaultdict(list)
    for img_path in extracted_paths:
        image_id = img_path.stem  # filename without extension
        if image_id in image_to_landmark:
            landmark_id = image_to_landmark[image_id]
            landmark_images[landmark_id].append(img_path)

    print(f"  Matched {sum(len(v) for v in landmark_images.values())} images to {len(landmark_images)} landmarks")

    # Filter to landmarks with 2+ matched images
    valid_landmarks = {
        lid: paths for lid, paths in landmark_images.items()
        if len(paths) >= 2
    }
    print(f"  Landmarks with 2+ images: {len(valid_landmarks)}")

    # Sample if we have too many
    landmark_ids = list(valid_landmarks.keys())
    random.seed(42)
    random.shuffle(landmark_ids)
    selected = landmark_ids[:max_landmarks]

    # Move and resize images
    organized = 0
    for lid in tqdm(selected, desc="Organizing", total=len(selected)):
        landmark_dir = GLDV2_DIR / lid
        landmark_dir.mkdir(parents=True, exist_ok=True)

        paths = valid_landmarks[lid][:images_per_landmark]
        for src_path in paths:
            dest_path = landmark_dir / src_path.name
            if dest_path.exists():
                continue
            try:
                img = Image.open(src_path).convert('RGB')
                img = img.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
                img.save(dest_path, 'JPEG', quality=85)
                organized += 1
            except Exception:
                pass

    return organized, len(selected)


def main():
    parser = argparse.ArgumentParser(description="Download GLDv2 subset for base training")
    parser.add_argument('--tars', type=int, default=1,
                        help='Number of tar files to download (each ~1GB, default: 1)')
    parser.add_argument('--max_landmarks', type=int, default=500,
                        help='Max landmarks to keep (default: 500)')
    parser.add_argument('--images_per_landmark', type=int, default=10,
                        help='Max images per landmark (default: 10)')
    parser.add_argument('--tar_start', type=int, default=0,
                        help='Starting tar index 0-499 (default: 0)')
    parser.add_argument('--keep_raw', action='store_true',
                        help='Keep raw extracted images (default: clean up)')
    args = parser.parse_args()

    print("=" * 50)
    print("Google Landmarks v2 — Dataset Downloader")
    print("=" * 50)
    print(f"  Tar files to download: {args.tars} (~{args.tars}GB)")
    print(f"  Max landmarks: {args.max_landmarks}")
    print(f"  Max images/landmark: {args.images_per_landmark}")
    print()

    # Step 1: Download & parse the clean CSV
    csv_path = download_file(GLDV2_CSV_URL, CSV_CACHE, "train_clean.csv (~26MB)")
    image_to_landmark, _ = parse_clean_csv(csv_path)

    # Step 2: Download tar files
    all_extracted = []
    for i in range(args.tar_start, args.tar_start + args.tars):
        tar_url = GLDV2_TAR_URL.format(i)
        tar_path = TAR_CACHE_DIR / f"images_{i:03d}.tar"
        download_file(tar_url, tar_path, f"images_{i:03d}.tar (~1GB)")
        extracted = extract_tar(tar_path, EXTRACT_DIR)
        all_extracted.extend(extracted)

    # Step 3: Organize by landmark
    GLDV2_DIR.mkdir(parents=True, exist_ok=True)
    organize_images(
        all_extracted, image_to_landmark,
        args.max_landmarks, args.images_per_landmark
    )

    # Step 4: Clean up raw extracts (keep tars for potential re-use)
    if not args.keep_raw and EXTRACT_DIR.exists():
        print(f"  Cleaning up raw extracts...")
        shutil.rmtree(EXTRACT_DIR)

    # Step 5: Summary
    final_landmarks = [d for d in GLDV2_DIR.iterdir() if d.is_dir()]
    final_images = sum(len(list(d.glob("*.jpg"))) for d in final_landmarks)

    print()
    print("=" * 50)
    print("Download Complete")
    print("=" * 50)
    print(f"  Landmarks: {len(final_landmarks)}")
    print(f"  Total images: {final_images}")
    print(f"  Data location: {GLDV2_DIR.resolve()}")
    print(f"\n  Next step: python scripts/train_base.py")


if __name__ == "__main__":
    main()
