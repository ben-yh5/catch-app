#!/bin/bash

# Catch App ML Pipeline Runner
# Usage: ./scripts/manage_ml_pipeline.sh

# Always run from project root, regardless of where script is invoked
cd "$(dirname "$0")/.." || exit 1

echo "Catch App ML Pipeline"
echo "========================"

PS3='Select a step to run: '
while true; do
    echo ""
    echo "--- Base Training (Public Dataset) ---"
    echo "1) Download GLDv2 Dataset"
    echo "2) Train Base Model (GLDv2)"
    echo ""
    echo "--- Fine-Tuning (App Data) ---"
    echo "3) Download App Data"
    echo "4) Clean/Verify App Data (GUI)"
    echo "5) Fine-Tune Model (App Data)"
    echo ""
    echo "--- Tools ---"
    echo "6) Test Similarity"
    echo "7) Export Model (Custom)"
    echo "8) Quit"
    echo ""
    read -p "Select a step to run: " opt

    case $opt in
        1)
            echo ""
            echo "Downloading GLDv2 subset..."
            read -p "   Number of landmarks (default 500): " num_landmarks
            read -p "   Images per landmark (default 5): " imgs_per

            cmd="python scripts/download_gldv2.py"
            if [ ! -z "$num_landmarks" ]; then
                cmd="$cmd --landmarks $num_landmarks"
            fi
            if [ ! -z "$imgs_per" ]; then
                cmd="$cmd --images_per_landmark $imgs_per"
            fi

            echo "   Running: $cmd"
            $cmd
            ;;
        2)
            echo ""
            echo "Training base model on GLDv2..."
            read -p "   Epochs (default 15): " base_epochs
            read -p "   Steps per epoch (default 500): " steps

            cmd="python scripts/train_base.py"
            if [ ! -z "$base_epochs" ]; then
                cmd="$cmd --epochs $base_epochs"
            fi
            if [ ! -z "$steps" ]; then
                cmd="$cmd --steps_per_epoch $steps"
            fi

            echo "   Running: $cmd"
            $cmd
            ;;
        3)
            echo ""
            echo "Downloading recent training pairs..."
            python scripts/download_data.py --limit 200
            echo "Done."
            ;;
        4)
            echo ""
            echo "Launching Streamlit..."
            streamlit run scripts/clean_data.py
            # Streamlit blocks, so we allow loop to continue if they kill it
            ;;
        5)
            echo ""
            echo "Fine-tuning on app data..."

            # Check if base weights exist
            if [ -f "models/base_weights.weights.h5" ]; then
                read -p "   Base weights found. Use them? (Y/n): " use_base
                use_base=${use_base:-Y}
            else
                use_base="n"
                echo "   No base weights found at models/base_weights.weights.h5"
                echo "   Training from ImageNet initialization (run step 2 first for better results)"
            fi

            read -p "   Epochs (default 10): " ft_epochs

            cmd="python scripts/train_siamese.py --data_dir training_data"
            if [ ! -z "$ft_epochs" ]; then
                cmd="$cmd --epochs $ft_epochs"
            fi
            if [[ "$use_base" =~ ^[Yy]$ ]]; then
                cmd="$cmd --base_weights models/base_weights.weights.h5"
            fi

            echo "   Running: $cmd"
            $cmd
            # Model is automatically saved to assets/models
            ;;
        6)
            echo ""
            echo "Testing Similarity..."
            read -p "Path to Image 1: " img1
            read -p "Path to Image 2: " img2
            # Remove quotes if user dragged/dropped and added them
            img1="${img1%\"}"
            img1="${img1#\"}"
            img2="${img2%\"}"
            img2="${img2#\"}"

            python scripts/test_similarity.py "$img1" "$img2"
            ;;
        7)
            echo ""
            echo "Exporting Model..."
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
        8)
            echo "Bye!"
            break
            ;;
        *)
            echo "Invalid option"
            ;;
    esac
done
