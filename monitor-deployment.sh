#!/bin/bash
echo "🔍 Monitoring Cerebras Deployment..."
echo "========================================"
echo ""

check_count=0
max_checks=60  # 30 minutes max

while [ $check_count -lt $max_checks ]; do
    echo "⏳ Check $((check_count + 1))/$max_checks ($(date '+%H:%M:%S'))"
    
    # Check if package exists on npm
    if npm view cerebras-ai version 2>/dev/null; then
        version=$(npm view cerebras-ai version 2>/dev/null)
        echo ""
        echo "🎉 SUCCESS! Package is live on npm!"
        echo "================================================"
        echo ""
        echo "📦 Package: cerebras-ai"
        echo "🔖 Version: $version"
        echo ""
        echo "✅ You can now install with:"
        echo ""
        echo "   npm install -g cerebras-ai"
        echo ""
        echo "   OR"
        echo ""
        echo "   curl -fsSL https://raw.githubusercontent.com/arihantchoudhary/opencode/dev/install | bash"
        echo ""
        exit 0
    fi
    
    # Check workflow status
    status=$(gh api repos/arihantchoudhary/opencode/actions/workflows/210701172/runs --jq '.workflow_runs[0] | "\(.status)|\(.conclusion // "running")"' 2>/dev/null)
    
    if [ ! -z "$status" ]; then
        workflow_status=$(echo $status | cut -d'|' -f1)
        workflow_conclusion=$(echo $status | cut -d'|' -f2)
        
        if [ "$workflow_status" = "completed" ] && [ "$workflow_conclusion" = "failure" ]; then
            echo ""
            echo "❌ Workflow failed! Check: https://github.com/arihantchoudhary/opencode/actions"
            exit 1
        fi
        
        echo "   Workflow: $workflow_status ($workflow_conclusion)"
    fi
    
    ((check_count++))
    sleep 30
done

echo ""
echo "⏱️  Timeout: Deployment is taking longer than expected"
echo "Check manually: https://github.com/arihantchoudhary/opencode/actions"
