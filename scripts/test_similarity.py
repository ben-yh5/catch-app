import tensorflow as tf
import numpy as np
import argparse
import os
from PIL import Image

def load_tflite_model(model_path):
    interpreter = tf.lite.Interpreter(model_path=str(model_path))
    interpreter.allocate_tensors()
    return interpreter

def preprocess_image(image_path):
    """Preprocesses image to match MobileNetV2 input requirements."""
    img = Image.open(image_path).convert('RGB')
    img = img.resize((224, 224))
    img_array = np.array(img, dtype=np.float32)
    
    # MobileNetV2 expects inputs in range [-1, 1]
    img_array = (img_array / 127.5) - 1.0
    
    # Add batch dimension
    img_array = np.expand_dims(img_array, axis=0)
    return img_array

def get_embedding(interpreter, image_data):
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    interpreter.set_tensor(input_details[0]['index'], image_data)
    interpreter.invoke()
    embedding = interpreter.get_tensor(output_details[0]['index'])
    return embedding[0]

def cosine_similarity(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

def main():
    parser = argparse.ArgumentParser(description='Test similarity between two images.')
    parser.add_argument('image1', help='Path to first image')
    parser.add_argument('image2', help='Path to second image')
    parser.add_argument('--model', default='assets/models/view_encoder.tflite', help='Path to TFLite model')
    
    args = parser.parse_args()

    if not os.path.exists(args.model):
        print(f"❌ Model not found at {args.model}")
        print("   Run 'Train Model' first to generate it.")
        return

    print(f"Loading model from {args.model}...")
    interpreter = load_tflite_model(args.model)

    print(f"Processing images...")
    img1_path = os.path.expanduser(args.image1)
    img2_path = os.path.expanduser(args.image2)
    
    img1 = preprocess_image(img1_path)
    img2 = preprocess_image(img2_path)

    print("Computing embeddings...")
    emb1 = get_embedding(interpreter, img1)
    emb2 = get_embedding(interpreter, img2)

    score = cosine_similarity(emb1, emb2)
    
    print("\n" + "="*30)
    print(f"🔍 Similarity Score: {score:.4f}")
    print("="*30)
    
    if score > 0.65:
        print("✅ MATCH (Score > 0.65)")
    else:
        print("❌ NO MATCH (Score < 0.65)")

if __name__ == "__main__":
    main()
