import tensorflow as tf
import os
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Must match training scripts
class L2Normalize(tf.keras.layers.Layer):
    def call(self, x):
        return tf.math.l2_normalize(x, axis=1)


def create_encoder():
    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(224, 224, 3),
        include_top=False,
        pooling='avg'
    )
    normalized = L2Normalize()(base_model.output)
    return tf.keras.Model(inputs=base_model.input, outputs=normalized)

def export_model(model_name, weights_path=None, output_dir='../assets/models'):
    print(f"🚀 Starting model export for: {model_name}")
    
    # 1. Create the base model architecture
    print("   Building MobileNetV2 architecture...")
    model = create_encoder()
    
    # 2. Load weights if provided
    if weights_path:
        print(f"   Loading weights from: {weights_path}")
        if not os.path.exists(weights_path):
            print(f"❌ Error: Weights file not found at {weights_path}")
            return
        try:
            # We assume weights were saved with save_weights() or as a full model
            # This attempts to load them into our architecture
            model.load_weights(weights_path)
            print("   ✅ Weights loaded successfully")
        except Exception as e:
            print(f"❌ Error loading weights: {e}")
            return
    else:
        print("   ⚠️  No weights provided. Exporting with ImageNet initialization (Untrained for this task!)")

    # 3. Convert to TFLite
    print("   Converting to TFLite...")
    # Run a dummy input to ensure shapes are concrete
    dummy_input = tf.random.normal([1, 224, 224, 3])
    model(dummy_input)

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()
    
    # 4. Save
    # Resolve output directory relative to this script if it's a relative path
    script_dir = Path(__file__).parent
    
    # Handle both absolute and relative output paths
    if os.path.isabs(output_dir):
        out_path = Path(output_dir)
    else:
        out_path = script_dir / output_dir
        
    out_path.mkdir(parents=True, exist_ok=True)
    
    final_output_path = out_path / f"{model_name}.tflite"
    
    with open(final_output_path, 'wb') as f:
        f.write(tflite_model)
        
    print(f"✅ Model exported to: {final_output_path}")
    print(f"   Size: {len(tflite_model) / 1024:.2f} KB")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export MobileNetV2 View Verification Model to TFLite")
    
    # Defaults
    default_name = os.getenv('MODEL_NAME', 'view_encoder')
    
    parser.add_argument('--name', type=str, default=default_name, 
                        help=f"Name of the output model (default: {default_name})")
    
    parser.add_argument('--weights', type=str, default=None, 
                        help="Path to trained weights file (.h5, .ckpt). If omitted, uses ImageNet weights.")
    
    parser.add_argument('--output_dir', type=str, default='../assets/models',
                        help="Directory to save the TFLite model")

    args = parser.parse_args()
    
    export_model(args.name, args.weights, args.output_dir)
