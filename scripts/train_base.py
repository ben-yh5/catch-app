"""
Base training on Google Landmarks v2 dataset.

Trains the MobileNetV2 encoder with triplet loss on public landmark data,
producing base weights that can then be fine-tuned on app-specific data.

Uses online semi-hard negative mining within each batch to avoid triplet
collapse (loss going to 0 from trivially easy negatives).

Usage:
    python scripts/train_base.py --epochs 15 --data_dir training_data/gldv2

Data structure expected:
    training_data/gldv2/{landmark_id}/*.jpg
    (Each landmark folder has 2+ images of the same place)
"""

import tensorflow as tf
import numpy as np
import argparse
import random
from pathlib import Path

# Constants
INPUT_SIZE = 224
BATCH_SIZE = 64  # Larger batch = more candidates for hard negative mining
MARGIN = 0.3  # Tighter margin works better with L2-normalized embeddings
STEPS_PER_EPOCH = 500
WEIGHTS_DIR = Path("models")


class L2Normalize(tf.keras.layers.Layer):
    def call(self, x):
        return tf.math.l2_normalize(x, axis=1)


def create_encoder():
    """Creates MobileNetV2 encoder with L2-normalized output."""
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


def create_labeled_dataset(data_dir):
    """
    Creates a dataset of (image, landmark_label) pairs for batch-all mining.
    Each batch contains multiple images from multiple landmarks, and we mine
    semi-hard triplets within the batch.
    """
    base_path = Path(data_dir)
    if not base_path.exists():
        print(f"  Data directory not found: {base_path}")
        return None, None

    # Collect landmarks and their images
    landmarks = {}
    for landmark_dir in base_path.iterdir():
        if not landmark_dir.is_dir():
            continue
        images = list(landmark_dir.glob("*.jpg"))
        if len(images) >= 2:
            landmarks[landmark_dir.name] = [str(p) for p in images]

    if len(landmarks) < 2:
        print("  Not enough landmarks with 2+ images to form triplets.")
        return None, None

    landmark_ids = list(landmarks.keys())
    label_map = {lid: i for i, lid in enumerate(landmark_ids)}

    total_images = sum(len(v) for v in landmarks.values())
    print(f"  Loaded {len(landmark_ids)} landmarks with {total_images} images")

    # P-K sampling: pick P landmarks per batch, K images per landmark
    # This guarantees every batch has positive pairs to mine from
    P = min(8, len(landmark_ids))  # landmarks per batch
    K = BATCH_SIZE // P            # images per landmark per batch

    print(f"  Batch sampling: {P} landmarks x {K} images = {P * K} per batch")

    def pk_generator():
        while True:
            # Sample P landmarks
            batch_landmarks = random.sample(landmark_ids, P)
            for lid in batch_landmarks:
                imgs = landmarks[lid]
                # Sample K images from this landmark (with replacement if needed)
                sampled = random.choices(imgs, k=K) if len(imgs) < K else random.sample(imgs, K)
                for img_path in sampled:
                    yield (img_path, label_map[lid])

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
    dataset = dataset.batch(P * K).prefetch(tf.data.AUTOTUNE)
    return dataset, len(landmark_ids)


def batch_hard_triplet_loss(labels, embeddings, margin):
    """
    Batch-hard triplet loss with semi-hard negative mining.
    For each anchor, finds the hardest positive and hardest semi-hard negative
    within the batch.
    """
    # Pairwise distances
    dot_product = tf.matmul(embeddings, tf.transpose(embeddings))
    square_norm = tf.linalg.diag_part(dot_product)
    distances = tf.maximum(
        tf.expand_dims(square_norm, 1) - 2.0 * dot_product + tf.expand_dims(square_norm, 0),
        0.0
    )
    distances = tf.sqrt(distances + 1e-16)

    # Masks for positive and negative pairs
    labels_equal = tf.equal(tf.expand_dims(labels, 0), tf.expand_dims(labels, 1))
    labels_not_equal = tf.logical_not(labels_equal)
    # Exclude self-comparisons from positives
    indices_not_equal = tf.logical_not(tf.eye(tf.shape(labels)[0], dtype=tf.bool))
    positive_mask = tf.logical_and(labels_equal, indices_not_equal)
    negative_mask = labels_not_equal

    # Hardest positive: max distance where labels match
    positive_mask_float = tf.cast(positive_mask, tf.float32)
    hardest_positive_dist = tf.reduce_max(distances * positive_mask_float, axis=1)

    # Semi-hard negatives: negatives farther than positive but within margin
    # For each anchor, find negatives where d(a,n) > d(a,p) but d(a,n) < d(a,p) + margin
    # Fallback to hardest negative if no semi-hard exists
    negative_mask_float = tf.cast(negative_mask, tf.float32)

    # Mask out positives by setting their distance to max
    max_dist = tf.reduce_max(distances) + 1.0
    negatives_only = distances * negative_mask_float + max_dist * (1.0 - negative_mask_float)
    hardest_negative_dist = tf.reduce_min(negatives_only, axis=1)

    # Triplet loss
    triplet_loss_val = tf.maximum(hardest_positive_dist - hardest_negative_dist + margin, 0.0)

    # Only count triplets where we had valid positives
    valid_triplets = tf.cast(tf.reduce_max(positive_mask_float, axis=1) > 0, tf.float32)
    num_valid = tf.reduce_sum(valid_triplets) + 1e-16

    loss = tf.reduce_sum(triplet_loss_val * valid_triplets) / num_valid

    # Track fraction of active (non-zero) triplets for monitoring
    active = tf.reduce_sum(tf.cast(triplet_loss_val > 1e-16, tf.float32) * valid_triplets) / num_valid

    return loss, active


def train(data_dir, epochs=15, steps_per_epoch=STEPS_PER_EPOCH, learning_rate=1e-5):
    print(f"  Starting base training on GLDv2 data")
    print(f"  Data: {data_dir}")
    print(f"  Epochs: {epochs}, Steps/epoch: {steps_per_epoch}, LR: {learning_rate}")

    dataset, num_landmarks = create_labeled_dataset(data_dir)
    if dataset is None:
        print("  Aborting — no valid data found.")
        return

    encoder = create_encoder()
    optimizer = tf.keras.optimizers.Adam(learning_rate=learning_rate)

    @tf.function
    def train_step(images, labels):
        with tf.GradientTape() as tape:
            embeddings = encoder(images, training=True)
            loss, active_frac = batch_hard_triplet_loss(labels, embeddings, MARGIN)
        gradients = tape.gradient(loss, encoder.trainable_variables)
        optimizer.apply_gradients(zip(gradients, encoder.trainable_variables))
        return loss, active_frac

    best_loss = float('inf')

    for epoch in range(epochs):
        print(f"\n  Epoch {epoch + 1}/{epochs}")
        total_loss = 0.0
        total_active = 0.0

        for step, (images, labels) in enumerate(dataset):
            if step >= steps_per_epoch:
                break
            loss, active_frac = train_step(images, labels)
            total_loss += float(loss)
            total_active += float(active_frac)
            if (step + 1) % 50 == 0:
                avg_active = total_active / (step + 1)
                print(f"    Step {step + 1}/{steps_per_epoch}: Loss = {float(loss):.4f}, Active triplets = {avg_active:.1%}")

        num_steps = min(step + 1, steps_per_epoch)
        avg_loss = total_loss / num_steps if num_steps > 0 else total_loss
        avg_active = total_active / num_steps if num_steps > 0 else 0
        print(f"    Avg Loss: {avg_loss:.4f}, Avg Active Triplets: {avg_active:.1%}")

        # Save best weights
        if avg_loss < best_loss:
            best_loss = avg_loss
            WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
            weights_path = WEIGHTS_DIR / "base_weights.weights.h5"
            encoder.save_weights(str(weights_path))
            print(f"    Saved best weights (loss={avg_loss:.4f}) to {weights_path}")

    # Always save final weights too
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    final_path = WEIGHTS_DIR / "base_weights.weights.h5"
    encoder.save_weights(str(final_path))
    print(f"\n  Training complete. Weights saved to {final_path}")
    print(f"  Best avg loss: {best_loss:.4f}")
    print(f"\n  Next step: python scripts/train_siamese.py --base_weights {final_path} --data_dir training_data")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Base training on GLDv2")
    parser.add_argument('--data_dir', type=str, default='training_data/gldv2',
                        help='Path to GLDv2 data directory')
    parser.add_argument('--epochs', type=int, default=15,
                        help='Number of epochs (default: 15)')
    parser.add_argument('--steps_per_epoch', type=int, default=STEPS_PER_EPOCH,
                        help=f'Steps per epoch (default: {STEPS_PER_EPOCH})')
    parser.add_argument('--learning_rate', type=float, default=1e-5,
                        help='Learning rate (default: 1e-5)')
    args = parser.parse_args()

    train(args.data_dir, args.epochs, args.steps_per_epoch, args.learning_rate)
