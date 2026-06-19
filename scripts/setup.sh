#!/bin/bash
set -e

echo "=== Stellar Whisper Setup Script ==="

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Cargo/Rust is not installed. Please install Rust first: https://rustup.rs/"
    exit 1
fi

# Check if Stellar CLI is installed
if ! command -v stellar &> /dev/null; then
    echo "❌ Stellar CLI is not installed. Please install it using: cargo install --locked stellar-cli"
    exit 1
fi

# Check and install Nargo (Noir compiler)
if ! command -v nargo &> /dev/null; then
    echo "ℹ️ Nargo not found. Installing noirup (Noir compiler manager)..."
    curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
    
    # Export path for current session
    export PATH="$HOME/.nargo/bin:$PATH"
    
    if [ -f "$HOME/.nargo/bin/noirup" ] || command -v noirup &> /dev/null; then
        echo "ℹ️ Running noirup to install latest stable Nargo..."
        # Add to PATH and run noirup
        export PATH="$HOME/.nargo/bin:$PATH"
        bash "$HOME/.nargo/bin/noirup" -v 0.32.0
    else
        echo "⚠️ noirup installed, but not in current PATH. Please run: export PATH=\"\$HOME/.nargo/bin:\$PATH\""
    fi
else
    echo "✅ Nargo is already installed: $(nargo --version)"
fi

# Setup frontend dependencies
echo "ℹ️ Setting up frontend packages..."
cd frontend
npm install
cd ..

echo "=== Setup Complete! ==="
echo "To make sure nargo is available in your terminal, run:"
echo "export PATH=\"\$HOME/.nargo/bin:\$PATH\""
