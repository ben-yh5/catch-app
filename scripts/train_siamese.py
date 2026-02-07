import tensorflow as tf
import numpy as np
import os
import argparse
import random
from pathlib import Path

# Constants
INPUT_SIZE = 224
BATCH_SIZE = 32
MARGIN = 0.5  # Triplet loss margin

# 1. Load MobileNetV2 Backbone
def create_encoder():
    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(224, 224, 3), include_top=False, pooling='avg'
    )
    # Freeze initial layers to preserve features; train only the last 20
    base_model.trainable = True
    for layer in base_model.layers[:-20]:
        layer.trainable = False
        
    return tf.keras.Model(inputs=base_model.input, outputs=base_model.output)

# 2. Siamese Network Wrapper (Shared Encoder)
class SiameseModel(tf.keras.Model):
    def __init__(self, encoder):
        super(SiameseModel, self).__init__()
        self.encoder = encoder
        
    def call(self, inputs):
        anchor, positive, negative = inputs
        embed_a = self.encoder(anchor)
        embed_p = self.encoder(positive)
        embed_n = self.encoder(negative)
        return embed_a, embed_p, embed_n

# 3. Triplet Loss (d_pos < d_neg + margin)
def triplet_loss(margin=MARGIN):
    def loss(y_true, y_pred):
        # y_pred implies the model returned (anchor, pos, neg) embeddings
        # But Keras expects (batch, output) so we need to handle it or use a custom loop.
        # However, typically simple Triplet Loss is computed on embeddings.
        
        # NOTE: For cleaner Keras integration, we usually calculate loss inside the train_step 
        # or output a single value. For this script, we'll implement it manually in a custom training loop 
        # or use the add_loss API if we were building a Keras layer. 
        # Here we will define the math:
        
        anchor, positive, negative = y_pred[0], y_pred[1], y_pred[2]
        
        pos_dist = tf.reduce_sum(tf.square(anchor - positive), axis=-1)
        neg_dist = tf.reduce_sum(tf.square(anchor - negative), axis=-1)
        
        basic_loss = pos_dist - neg_dist + margin
        return tf.reduce_mean(tf.maximum(basic_loss, 0.0))
    return loss

# 4. Data Loading
def load_image(path):
    raw = tf.io.read_file(path)
    img = tf.image.decode_jpeg(raw, channels=3)
    img = tf.image.resize(img, [INPUT_SIZE, INPUT_SIZE])
    img = (img - 127.5) / 127.5  # Normalize to [-1, 1]
    return img

def create_dataset(data_dir):
    """
    Creates a triplet dataset from the 'verified/positive' directory.
    Structure: data_dir/verified/positive/{pair_id}/[original.jpg, catch.jpg]
    """
    base_path = Path(data_dir) / 'verified' / 'positive'
    if not base_path.exists():
        print(f"⚠️ Warning: No data found at {base_path}")
        return None

    pair_folders = [f for f in base_path.iterdir() if f.is_dir()]
    
    if len(pair_folders) < 2:
        print("⚠️ Not enough pairs to form triplets (need at least 2 for negatives).")
        return None

    print(f"   Found {len(pair_folders)} positive pairs.")

    # Generator for triplets
    def triplet_generator():
        # Group folders by Original ID to avoid False Negatives
        # Folder name format: {originalId}_{timestamp}
        grouped_folders = {}
        for folder in pair_folders:
            # Extract original_id (everything before the last underscore)
            # If manual naming was used and no underscore, use full name.
            folder_name = folder.name
            if '_' in folder_name:
                group_id = folder_name.rsplit('_', 1)[0]
            else:
                group_id = folder_name
            
            if group_id not in grouped_folders:
                grouped_folders[group_id] = []
            grouped_folders[group_id].append(folder)

        group_ids = list(grouped_folders.keys())
        
        if len(group_ids) < 2:
            print("⚠️ Not enough distinct locations to form triplets (need at least 2 groups).")
            return

        print(f"   Identified {len(group_ids)} distinct locations from {len(pair_folders)} folders.")

        while True: # Infinite generator for dataset
            # Shuffle groups to ensure variety per epoch if we weren't infinite
            # For infinite, random.choice is fine.
            
            # 1. Select an Anchor Group
            anchor_group_id = random.choice(group_ids)
            anchor_folder = random.choice(grouped_folders[anchor_group_id])
            
            orig_path = str(anchor_folder / 'original.jpg')
            catch_path = str(anchor_folder / 'catch.jpg')
            
            # 2. Select a Negative Group (MUST be different from Anchor Group)
            neg_group_id = anchor_group_id
            while neg_group_id == anchor_group_id:
                neg_group_id = random.choice(group_ids)
            
            # 3. Select Negative Sample
            neg_folder = random.choice(grouped_folders[neg_group_id])
            neg_path = str(neg_folder / 'original.jpg') # Use the other location's original as negative

            yield (orig_path, catch_path, neg_path)

    dataset = tf.data.Dataset.from_generator(
        triplet_generator,
        output_signature=(
            tf.TensorSpec(shape=(), dtype=tf.string),
            tf.TensorSpec(shape=(), dtype=tf.string),
            tf.TensorSpec(shape=(), dtype=tf.string),
        )
    )

    dataset = dataset.map(lambda a, p, n: (load_image(a), load_image(p), load_image(n)))
    dataset = dataset.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)
    return dataset

# 5. Training Loop
def train(data_dir, epochs=10):
    print(f"🚀 Starting TensorFlow training on {data_dir}")
    
    dataset = create_dataset(data_dir)
    if dataset is None: 
        print("❌ Aborting training due to missing data.")
        return

    encoder = create_encoder()
    siamese_model = SiameseModel(encoder)
    
    optimizer = tf.keras.optimizers.Adam(learning_rate=1e-5)
    loss_fn = triplet_loss(MARGIN)

    # Custom Training Step
    @tf.function
    def train_step(data):
        with tf.GradientTape() as tape:
            anchor, positive, negative = data
            
            # Forward pass
            # We explicitly call the model with a list or tuple of inputs
            # But our call() method expects a single argument that unpacks.
            embeddings = siamese_model((anchor, positive, negative))
            
            # Calculate loss
            # y_true is ignored for unsupervised triplet loss
            loss = loss_fn(None, embeddings)
            
        gradients = tape.gradient(loss, siamese_model.trainable_variables)
        optimizer.apply_gradients(zip(gradients, siamese_model.trainable_variables))
        return loss

    # Filter out empty datasets check if needed, but TF handles it.
    
    for epoch in range(epochs):
        print(f"\nEpoch {epoch+1}/{epochs}")
        total_loss = 0.0
        steps = 0
        
        for batch in dataset:
            loss = train_step(batch)
            total_loss += float(loss)
            steps += 1
            if steps % 5 == 0:
                print(f"   Step {steps}: Loss = {float(loss):.4f}")
        
        if steps > 0:
            print(f"   Avg Loss: {total_loss / steps:.4f}")
        else:
            print("   (No batches processed - check dataset)")

    
    print("✅ Training complete.")
    
    # Export the ENCODER only (we don't need the siamese wrapper for inference)
    print("💾 Converting to TFLite...")
    
    # We need to build the encoder with a concrete input shape if not already
    dummy_input = tf.random.normal([1, 224, 224, 3])
    encoder(dummy_input)

    converter = tf.lite.TFLiteConverter.from_keras_model(encoder)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()
    
    # Save to app assets so it's ready to use
    assets_dir = Path(__file__).parent.parent / 'assets' / 'models'
    assets_dir.mkdir(parents=True, exist_ok=True)
    output_path = assets_dir / 'view_encoder.tflite'
    
    with open(output_path, 'wb') as f:
        f.write(tflite_model)
    print(f"✅ Model exported to {output_path}")
    print("   (This overwrites the previous model, so the app will use this new version)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--data_dir', type=str, default='training_data')
    parser.add_argument('--epochs', type=int, default=10)
    args = parser.parse_args()
    
    train(args.data_dir, args.epochs)
