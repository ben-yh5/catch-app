#!/bin/bash

# Catch App ML Pipeline Runner
# Usage: ./scripts/run_pipeline.sh

echo "🧠 Catch App ML Pipeline"
echo "========================"

PS3='👉 Select a step to run: '
while true; do
    echo ""
    echo "1) Download New Data"
    echo "2) Clean/Verify Data (GUI)"
    echo "3) Train Model"
    echo "4) Test Similarity"
    echo "5) Export Base Model"
    echo "6) Quit"
    echo ""
    read -p "👉 Select a step to run: " opt

    case $opt in
        1)
            echo ""
            echo "⬇️  Downloading recent training pairs..."
            python scripts/download_data.py --limit 200
            echo "✅ Done."
            ;;
        2)
            echo ""
            echo "🧹 Launching Streamlit..."
            streamlit run scripts/clean_data.py
            # Streamlit blocks, so we allow loop to continue if they kill it
            ;;
        3)
            echo ""
            echo "🏋️  Starting training..."
            python scripts/train_siamese.py --epochs 10 --data_dir training_data
            # Model is automatically saved to assets/models
            ;;
        4)
            echo ""
            echo "🧪 Testing Similarity..."
            read -p "Path to Image 1: " img1
            read -p "Path to Image 2: " img2
            # Remove quotes if user dragged/dropped and added them
            img1="${img1%\"}"
            img1="${img1#\"}"
            img2="${img2%\"}"
            img2="${img2#\"}"
            
            python scripts/test_similarity.py "$img1" "$img2"
            ;;
        5)
            echo ""
            echo "📦 Exporting original MobileNetV2..."
            python scripts/export_model.py
            ;;
        6)
            echo "Bye! 👋"
            break
            ;;
        *) 
            echo "❌ Invalid option"
            ;;
    esac
done
