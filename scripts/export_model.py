import tensorflow as tf
import os

base_model = tf.keras.applications.MobileNetV2(
    input_shape=(224, 224, 3),
    include_top=False, 
    pooling='avg'
)

model = tf.keras.Model(inputs=base_model.input, outputs=base_model.output)

converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
tflite_model = converter.convert()


assets_dir = os.path.join(os.path.dirname(__file__), '../assets/models')
os.makedirs(assets_dir, exist_ok=True)
output_path = os.path.join(assets_dir, 'view_encoder.tflite')

with open(output_path, 'wb') as f:
    f.write(tflite_model)

print(f"✅ Model exported to: {output_path}")
