import streamlit as st
import os
import shutil
import json
from pathlib import Path

# Config
RAW_DIR = Path("training_data/raw")
VERIFIED_POS_DIR = Path("training_data/verified/positive")
VERIFIED_NEG_DIR = Path("training_data/verified/negative")
MANIFEST_FILE = RAW_DIR / "manifest.json"

st.set_page_config(layout="wide", page_title="Catch Data Cleaner")

def load_manifest():
    if MANIFEST_FILE.exists():
        with open(MANIFEST_FILE, "r") as f:
            return json.load(f)
    return {}

def move_pair(pair_id, manifest_entry, target_dir):
    """Moves a pair folder to the target directory."""
    target_dir.mkdir(parents=True, exist_ok=True)
    
    src_dir = RAW_DIR / pair_id
    dest_dir = target_dir / pair_id
    
    if src_dir.exists():
        shutil.move(str(src_dir), str(dest_dir))
        return True
    return False

def delete_pair(pair_id):
    """Deletes a pair folder."""
    src_dir = RAW_DIR / pair_id
    if src_dir.exists():
        shutil.rmtree(src_dir)
        return True
    return False

def main():
    st.title("Catch App Data Verifier")
    
    # Stats
    manifest = load_manifest()
    
    # Filter only existing folders (in case manually moved)
    valid_pairs = [pid for pid in manifest.keys() if (RAW_DIR / pid).exists()]
    
    if not valid_pairs:
        st.success("No more images to verify.")
        st.info(f"Check {VERIFIED_POS_DIR} and {VERIFIED_NEG_DIR} for your data.")
        return

    # Progress
    total = len(manifest)
    remaining = len(valid_pairs)
    st.progress((total - remaining) / total if total > 0 else 0)
    st.caption(f"Remaining: {remaining} pairs")

    # Get current pair
    current_pair_id = valid_pairs[0]
    data = manifest[current_pair_id]
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.header("Original")
        st.image(data['original'], use_container_width=True)
    
    with col2:
        st.header("Catch Attempt")
        st.image(data['catch'], use_container_width=True)

    st.divider()

    # Actions
    c1, c2, c3 = st.columns([1, 1, 1])
    
    with c1:
        if st.button("Match (Positive)", type="primary", use_container_width=True):
            if move_pair(current_pair_id, data, VERIFIED_POS_DIR):
                st.toast(f"Moved {current_pair_id} to POSITIVE")
                st.rerun()
            else:
                st.error("Error moving file")

    with c2:
        if st.button("Hard Negative (Looks close, but not exact)", use_container_width=True):
            if move_pair(current_pair_id, data, VERIFIED_NEG_DIR):
                st.toast(f"Moved {current_pair_id} to NEGATIVE")
                st.rerun()
            else:
                st.error("Error moving file")

    with c3:
        if st.button("Trash (Bad Data)", use_container_width=True):
            if delete_pair(current_pair_id):
                st.toast(f"Deleted {current_pair_id}")
                st.rerun()
            else:
                st.error("Error deleting file")

    # Debug Info
    with st.expander("Debug Info"):
        st.json(data)

if __name__ == "__main__":
    main()
