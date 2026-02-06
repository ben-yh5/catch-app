#!/bin/bash

# Catch App ML Pipeline Runner
# Usage: ./scripts/manage_ml_pipeline.sh

echo "🧠 Catch App ML Pipeline"
echo "========================"

PS3='👉 Select a step to run: '
while true; do
    echo ""
    echo "1) Download New Data"
    echo "2) Clean/Verify Data (GUI)"
    echo "3) Train Model"
    echo "4) Test Similarity"
    echo "5) Export Model (Custom)"
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
            echo "📦 Exporting Model..."
            read -p "   Name for model (default: view_encoder): " model_name
            read -p "   Path to weights .h5 (optional, enter for ImageNet): " weights_path
            
            cmd="python scripts/export_model.py"
            
            if [ ! -z "$model_name" ]; then
                cmd="$cmd --name $model_name"
            fi
            
            if [ ! -z "$weights_path" ]; then
                cmd="$cmd --weights $weights_path"
            fi
            
            echo "   Running: $cmd"
            $cmd
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
