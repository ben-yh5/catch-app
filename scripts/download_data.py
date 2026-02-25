import firebase_admin
from firebase_admin import credentials, firestore, storage
import os
import json
import argparse
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Configuration
SERVICE_ACCOUNT_KEY = 'serviceAccountKey.json'
DATA_DIR = Path('training_data/raw')
DOWNLOADED_IDS_FILE = Path('training_data/downloaded_ids.json')
STORAGE_BUCKET = os.getenv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET')

def initialize_firebase():
    """Initializes Firebase Admin SDK."""
    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
    try:
        app = firebase_admin.initialize_app(cred, {
            'storageBucket': STORAGE_BUCKET
        })
        return app
    except ValueError:
        return firebase_admin.get_app()

def load_downloaded_ids():
    """Loads the set of previously downloaded pair IDs."""
    if DOWNLOADED_IDS_FILE.exists():
        with open(DOWNLOADED_IDS_FILE, 'r') as f:
            return set(json.load(f))
    return set()

def save_downloaded_ids(ids):
    """Persists the set of downloaded pair IDs."""
    DOWNLOADED_IDS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DOWNLOADED_IDS_FILE, 'w') as f:
        json.dump(sorted(ids), f, indent=2)

def scan_storage_bucket(bucket, limit, downloaded_ids):
    """Scans the storage bucket for training_data/ folders, skipping already-downloaded pairs."""
    print("\n  Scanning Storage Bucket...")

    blobs = list(bucket.list_blobs(prefix='training_data/'))

    # Group by parent folder
    pairs = {}
    for blob in blobs:
        parts = blob.name.split('/')
        # Expected: training_data/{pairId}/{filename}
        if len(parts) >= 3:
            pair_id = parts[1]
            filename = parts[-1]

            if pair_id not in pairs:
                pairs[pair_id] = {}
            pairs[pair_id][filename] = blob.name

    # Filter out already-downloaded pairs
    new_pairs = {pid: files for pid, files in pairs.items() if pid not in downloaded_ids}
    print(f"  Found {len(pairs)} total pairs in Storage.")
    print(f"  Already downloaded: {len(pairs) - len(new_pairs)}")
    print(f"  New pairs to download: {len(new_pairs)}")

    if not new_pairs:
        print("  No new pairs to download.")
        return {}

    count = 0
    manifest = {}

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    sorted_pairs = list(new_pairs.items())[:limit]

    for pair_id, files in sorted_pairs:
        print(f"  Processing {pair_id}...")

        pair_dir = DATA_DIR / pair_id
        pair_dir.mkdir(parents=True, exist_ok=True)

        original_path = pair_dir / 'original.jpg'
        catch_path = pair_dir / 'catch.jpg'

        # Download Original
        if 'original.jpg' in files:
            blob = bucket.blob(files['original.jpg'])
            blob.download_to_filename(str(original_path))

        # Download Catch
        if 'catch.jpg' in files:
            blob = bucket.blob(files['catch.jpg'])
            blob.download_to_filename(str(catch_path))

        if original_path.exists() and catch_path.exists():
            manifest[pair_id] = {
                'original': str(original_path),
                'catch': str(catch_path),
                'label': 'POSITIVE',
                'id': pair_id
            }
            count += 1
            print("    Downloaded.")

    return manifest

def main():
    parser = argparse.ArgumentParser(description='Download training data from Firebase.')
    parser.add_argument('--limit', type=int, default=100, help='Max number of new pairs to download')
    parser.add_argument('--reset-ledger', action='store_true',
                        help='Clear the downloaded IDs ledger (re-download everything)')
    args = parser.parse_args()

    # Handle ledger reset
    if args.reset_ledger:
        if DOWNLOADED_IDS_FILE.exists():
            os.remove(DOWNLOADED_IDS_FILE)
            print("  Ledger cleared. All pairs will be treated as new.")
        else:
            print("  No ledger file found, nothing to reset.")

    app = initialize_firebase()
    if not app:
        return

    db = firestore.client()
    bucket = storage.bucket()

    print(f"  Scanning Storage Bucket for training pairs (Limit: {args.limit})...")

    try:
        project_id = db.project
        print(f"  Connected to Project ID: {project_id}")
    except:
        pass

    # Load previously downloaded IDs
    downloaded_ids = load_downloaded_ids()
    print(f"  Previously downloaded pairs in ledger: {len(downloaded_ids)}")

    # Scan and download new pairs
    manifest = scan_storage_bucket(bucket, args.limit, downloaded_ids)

    if manifest:
        # Update the ledger with newly downloaded IDs
        downloaded_ids.update(manifest.keys())
        save_downloaded_ids(downloaded_ids)

        # Merge with existing manifest (if any)
        manifest_path = DATA_DIR / 'manifest.json'
        existing_manifest = {}
        if manifest_path.exists():
            with open(manifest_path, 'r') as f:
                existing_manifest = json.load(f)

        existing_manifest.update(manifest)
        with open(manifest_path, 'w') as f:
            json.dump(existing_manifest, f, indent=2)

        print(f"\n  Done! Downloaded {len(manifest)} new pairs.")
        print(f"  Total in ledger: {len(downloaded_ids)}")
        print(f"  Data saved to: {DATA_DIR.resolve()}")
    else:
        print("\n  No new data to download.")

if __name__ == "__main__":
    main()
