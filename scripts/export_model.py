import tensorflow as tf

# 1. Choose a "Backbone"
# MobileNetV3Small is the industry standard for fast on-device vision.
# It acts as an "Encoder" - turning an image into a unique 1024-dimensional vector.
# MobileNetV2 offers a good balance of accuracy and size.
# It tends to produce more distinct embeddings than V3-Small for this use case.
base_model = tf.keras.applications.MobileNetV2(
    input_shape=(224, 224, 3),
    include_top=False, 
    pooling='avg'
)

# 2. Define the Model
# This is our single-branch model. To compare two images, we run this model
# twice (once for each image) and then compare the two vectors.
model = tf.keras.Model(inputs=base_model.input, outputs=base_model.output)

# 3. Convert to TFLite
# TFLite is a compressed format optimized for mobile chips (NPU/GPU).
converter = tf.lite.TFLiteConverter.from_keras_model(model)

# Optimization: Quantization makes the model 4x smaller (approx 2MB)
# with almost no accuracy loss.
converter.optimizations = [tf.lite.Optimize.DEFAULT]
tflite_model = converter.convert()

# 4. Save the file
with open('view_encoder.tflite', 'wb') as f:
    f.write(tflite_model)

print("✅ Model exported! Place 'view_encoder.tflite' in: catch-app/assets/models/")
