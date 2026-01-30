import tensorflow as tf
import numpy as np
from PIL import Image
import argparse
import os

# Constants
INPUT_SIZE = 224
DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(__file__), '../assets/models/view_encoder.tflite')

def preprocess_image(image_path):
    """
    Loads, resizes, and normalizes an image for the MobileNetV3 model.
    Normalization means converting 0-255 range to -1.0 to 1.0 range.
    """
    try:
        img = Image.open(image_path).convert('RGB')
        img = img.resize((INPUT_SIZE, INPUT_SIZE))
        
        # Convert to numpy array
        img_array = np.array(img, dtype=np.float32)
        
        # Normalize to [-1, 1]
        # (value - 127.5) / 127.5
        img_array = (img_array - 127.5) / 127.5
        
        # Add batch dimension: (1, 224, 224, 3)
        img_array = np.expand_dims(img_array, axis=0)
        
        return img_array
    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return None

def calculate_cosine_similarity(vecA, vecB):
    """
    Calculates cosine similarity between two vectors.
    """
    # Flatten if necessary (though MobileNetV3 output is already 1D per batch item usually)
    vecA = vecA.flatten()
    vecB = vecB.flatten()
    
    dot_product = np.dot(vecA, vecB)
    normA = np.linalg.norm(vecA)
    normB = np.linalg.norm(vecB)
    
    if normA == 0 or normB == 0:
        return 0.0
        
    return dot_product / (normA * normB)

def main():
    parser = argparse.ArgumentParser(description='Test Siamese Model Similarity for specific images.')
    parser.add_argument('image1', type=str, help='Path to first image')
    parser.add_argument('image2', type=str, help='Path to second image')
    parser.add_argument('--model', type=str, default=DEFAULT_MODEL_PATH, help='Path to .tflite model file')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.model):
        print(f"❌ Model file not found at: {args.model}")
        print("Please run `python scripts/export_model.py` first.")
        return

    # Load TFLite Model
    interpreter = tf.lite.Interpreter(model_path=args.model)
    interpreter.allocate_tensors()
    
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    
    # Preprocess Images
    img1 = preprocess_image(args.image1)
    img2 = preprocess_image(args.image2)
    
    if img1 is None or img2 is None:
        return

    # Run Inference A
    interpreter.set_tensor(input_details[0]['index'], img1)
    interpreter.invoke()
    embedA = interpreter.get_tensor(output_details[0]['index'])[0] # Copy result
    
    # Run Inference B
    interpreter.set_tensor(input_details[0]['index'], img2)
    interpreter.invoke()
    embedB = interpreter.get_tensor(output_details[0]['index'])[0] # Copy result
    
    # Calculate Similarity
    score = calculate_cosine_similarity(embedA, embedB)
    dist = np.linalg.norm(embedA - embedB)
    
    print("-" * 30)
    print(f"ℹ️  Model Output Shape: {embedA.shape}")
    print(f"🖼️  Image 1: {os.path.basename(args.image1)}")
    print(f"🖼️  Image 2: {os.path.basename(args.image2)}")
    print("-" * 30)
    print(f"📊 Cosine Similarity: {score:.4f}")
    print(f"📏 Euclidean Dist:   {dist:.4f}")
    print(f"📉 Vector A Stats:   Mean={np.mean(embedA):.3f}, Min={np.min(embedA):.3f}, Max={np.max(embedA):.3f}")
    print("-" * 30)
    
    if score > 0.85:
        print("✅ MATCH (High Confidence)")
    elif score > 0.70:
        print("⚠️ MATCH (Medium Confidence)")
    else:
        print("❌ NO MATCH")

if __name__ == "__main__":
    main()
