{
  description = "Opencode development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    systems.url = "github:nix-systems/default";
  };

  outputs = inputs @ { flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = import inputs.systems;
      
      perSystem = { config, self', inputs', pkgs, system, ... }: {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Node.js/Bun runtime and package management
            bun
            nodejs_22
            
            # Go development
            go_1_24
            
            # Build tools and utilities
            git
            gnumake
            gcc
            
            # Development tools
            jq
            ripgrep
            curl
            
            # For building native modules if needed
            python3
            pkg-config
            
            # Additional tools that might be useful
            which
            file
          ];

          shellHook = ''
            echo "🚀 Opencode development environment"
            echo "Node.js: $(node --version)"
            echo "Bun: $(bun --version)"
            echo "Go: $(go version)"
            echo ""
            echo "Available commands:"
            echo "  bun install    - Install dependencies"
            echo "  bun run dev    - Start development server"
            echo "  bun typecheck  - Run type checking"
            echo ""
          '';

          # Set environment variables
          OPENCODE_DEV = "1";
          
          # Ensure proper locale settings
          LANG = "en_US.UTF-8";
          LC_ALL = "en_US.UTF-8";
        };
      };
    };
}