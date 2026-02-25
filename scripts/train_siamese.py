"""
Fine-tuning on app-collected training data.

Uses batch-hard triplet mining with P-K sampling, matching the approach
in train_base.py. Each pair folder has original.jpg + catch.jpg from the
same location; folders are grouped by original post ID as the location label.

Usage:
    python scripts/train_siamese.py --data_dir training_data --base_weights models/base_weights.weights.h5
"""

import tensorflow as tf
import numpy as np
import os
import argparse
import random
from pathlib import Path

# Constants
INPUT_SIZE = 224
MARGIN = 0.3
STEPS_PER_EPOCH = 100  # App data is small, fewer steps needed

MIN_LOCATIONS = 4  # Minimum distinct locations needed for meaningful training


class L2Normalize(tf.keras.layers.Layer):
    def call(self, x):
        return tf.math.l2_normalize(x, axis=1)


def create_encoder():
    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(224, 224, 3), include_top=False, pooling='avg'
    )
    base_model.trainable = True
    for layer in base_model.layers[:-20]:
        layer.trainable = False

    normalized = L2Normalize()(base_model.output)
    return tf.keras.Model(inputs=base_model.input, outputs=normalized)


def load_image(path):
    raw = tf.io.read_file(path)
    img = tf.image.decode_jpeg(raw, channels=3)
    img = tf.image.resize(img, [INPUT_SIZE, INPUT_SIZE])
    img = (img - 127.5) / 127.5
    return img


def create_dataset(data_dir):
    """
    Creates a labeled dataset from verified/positive for batch-hard mining.
    Groups folders by original post ID (location) as labels.
    Each folder contributes 2 images: original.jpg and catch.jpg.
    """
    base_path = Path(data_dir) / 'verified' / 'positive'
    if not base_path.exists():
        print(f"  No data found at {base_path}")
        return None, None

    pair_folders = [f for f in base_path.iterdir() if f.is_dir()]
    if len(pair_folders) < 2:
        print("  Not enough pairs (need at least 2).")
        return None, None

    print(f"  Found {len(pair_folders)} positive pairs.")

    # Group by original post ID (location)
    grouped = {}
    for folder in pair_folders:
        folder_name = folder.name
        if '_' in folder_name:
            group_id = folder_name.rsplit('_', 1)[0]
        else:
            group_id = folder_name

        if group_id not in grouped:
            grouped[group_id] = []
        # Each pair contributes 2 images of the same place
        grouped[group_id].append(str(folder / 'original.jpg'))
        grouped[group_id].append(str(folder / 'catch.jpg'))

    # Filter to groups with 2+ images (should always be true since each pair has 2)
    grouped = {gid: imgs for gid, imgs in grouped.items() if len(imgs) >= 2}
    group_ids = list(grouped.keys())

    if len(group_ids) < 2:
        print("  Not enough distinct locations (need at least 2).")
        return None, None

    print(f"  {len(group_ids)} distinct locations, {sum(len(v) for v in grouped.values())} total images")

    if len(group_ids) < MIN_LOCATIONS:
        print(f"  Warning: only {len(group_ids)} locations. Recommend {MIN_LOCATIONS}+ for meaningful training.")

    label_map = {gid: i for i, gid in enumerate(group_ids)}

    # P-K sampling: pick P locations per batch, K images per location
    P = min(len(group_ids), 8)
    K = max(4, 32 // P)  # At least 4 images per location per batch
    batch_size = P * K

    print(f"  Batch sampling: {P} locations x {K} images = {batch_size} per batch")

    def pk_generator():
        while True:
            batch_groups = random.sample(group_ids, P) if len(group_ids) >= P else group_ids
            for gid in batch_groups:
                imgs = grouped[gid]
                sampled = random.choices(imgs, k=K)
                for img_path in sampled:
                    yield (img_path, label_map[gid])

    dataset = tf.data.Dataset.from_generator(
        pk_generator,
        output_signature=(
            tf.TensorSpec(shape=(), dtype=tf.string),
            tf.TensorSpec(shape=(), dtype=tf.int32),
        )
    )
    dataset = dataset.map(
        lambda path, label: (load_image(path), label),
        num_parallel_calls=tf.data.AUTOTUNE
    )
    dataset = dataset.batch(batch_size).prefetch(tf.data.AUTOTUNE)
    return dataset, len(group_ids)


def batch_hard_triplet_loss(labels, embeddings, margin):
    """Same batch-hard mining as train_base.py."""
    dot_product = tf.matmul(embeddings, tf.transpose(embeddings))
    square_norm = tf.linalg.diag_part(dot_product)
    distances = tf.maximum(
        tf.expand_dims(square_norm, 1) - 2.0 * dot_product + tf.expand_dims(square_norm, 0),
        0.0
    )
    distances = tf.sqrt(distances + 1e-16)

    labels_equal = tf.equal(tf.expand_dims(labels, 0), tf.expand_dims(labels, 1))
    labels_not_equal = tf.logical_not(labels_equal)
    indices_not_equal = tf.logical_not(tf.eye(tf.shape(labels)[0], dtype=tf.bool))
    positive_mask = tf.logical_and(labels_equal, indices_not_equal)
    negative_mask = labels_not_equal

    positive_mask_float = tf.cast(positive_mask, tf.float32)
    hardest_positive_dist = tf.reduce_max(distances * positive_mask_float, axis=1)

    negative_mask_float = tf.cast(negative_mask, tf.float32)
    max_dist = tf.reduce_max(distances) + 1.0
    negatives_only = distances * negative_mask_float + max_dist * (1.0 - negative_mask_float)
    hardest_negative_dist = tf.reduce_min(negatives_only, axis=1)

    triplet_loss_val = tf.maximum(hardest_positive_dist - hardest_negative_dist + margin, 0.0)

    valid_triplets = tf.cast(tf.reduce_max(positive_mask_float, axis=1) > 0, tf.float32)
    num_valid = tf.reduce_sum(valid_triplets) + 1e-16

    loss = tf.reduce_sum(triplet_loss_val * valid_triplets) / num_valid
    active = tf.reduce_sum(tf.cast(triplet_loss_val > 1e-16, tf.float32) * valid_triplets) / num_valid

    return loss, active


def train(data_dir, epochs=10, base_weights=None):
    print(f"  Starting fine-tuning on app data: {data_dir}")

    dataset, num_locations = create_dataset(data_dir)
    if dataset is None:
        print("  Aborting — insufficient data.")
        return

    encoder = create_encoder()

    # Load base weights from GLDv2 pre-training if provided
    if base_weights:
        if os.path.exists(base_weights):
            print(f"  Loading base weights from: {base_weights}")
            dummy_input = tf.random.normal([1, 224, 224, 3])
            encoder(dummy_input)
            encoder.load_weights(base_weights)
            print("  Base weights loaded — fine-tuning on app data")
        else:
            print(f"  Base weights not found at {base_weights}, starting from ImageNet")

    # Lower learning rate for fine-tuning
    optimizer = tf.keras.optimizers.Adam(learning_rate=5e-6)

    @tf.function
    def train_step(images, labels):
        with tf.GradientTape() as tape:
            embeddings = encoder(images, training=True)
            loss, active_frac = batch_hard_triplet_loss(labels, embeddings, MARGIN)
        gradients = tape.gradient(loss, encoder.trainable_variables)
        optimizer.apply_gradients(zip(gradients, encoder.trainable_variables))
        return loss, active_frac

    steps = min(STEPS_PER_EPOCH, num_locations * 10)  # Scale steps with data size

    for epoch in range(epochs):
        print(f"\n  Epoch {epoch + 1}/{epochs}")
        total_loss = 0.0
        total_active = 0.0

        for step, (images, labels) in enumerate(dataset):
            if step >= steps:
                break
            loss, active_frac = train_step(images, labels)
            total_loss += float(loss)
            total_active += float(active_frac)
            if (step + 1) % 10 == 0:
                avg_active = total_active / (step + 1)
                print(f"    Step {step + 1}/{steps}: Loss = {float(loss):.4f}, Active = {avg_active:.1%}")

        num_steps = min(step + 1, steps)
        avg_loss = total_loss / num_steps if num_steps > 0 else 0
        avg_active = total_active / num_steps if num_steps > 0 else 0
        print(f"    Avg Loss: {avg_loss:.4f}, Avg Active: {avg_active:.1%}")

    print("\n  Training complete. Exporting to TFLite...")

    dummy_input = tf.random.normal([1, 224, 224, 3])
    encoder(dummy_input)

    converter = tf.lite.TFLiteConverter.from_keras_model(encoder)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()

    assets_dir = Path(__file__).parent.parent / 'assets' / 'models'
    assets_dir.mkdir(parents=True, exist_ok=True)
    output_path = assets_dir / 'view_encoder.tflite'

    with open(output_path, 'wb') as f:
        f.write(tflite_model)
    print(f"  Model exported to {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--data_dir', type=str, default='training_data')
    parser.add_argument('--epochs', type=int, default=10)
    parser.add_argument('--base_weights', type=str, default=None,
                        help='Path to base weights from GLDv2 pre-training (e.g. models/base_weights.weights.h5)')
    args = parser.parse_args()

    train(args.data_dir, args.epochs, args.base_weights)
