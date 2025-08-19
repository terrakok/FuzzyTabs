#!/bin/bash

# Create ZIP archive with required files
zip -r extension.zip icons/ background.js index.js manifest.json

# Check if zip command was successful
if [ $? -eq 0 ]; then
    echo "ZIP archive 'extension.zip' created successfully"
else
    echo "Error creating ZIP archive"
    exit 1
fi
