import { createEffect, createSignal, onCleanup } from 'solid-js';
import { getSlashCommandSuggestions } from '../lib/slash-commands';

interface AutocompleteProps {
  input: string;
  onSelect: (command: string) => void;
  position: { x: number; y: number };
}

export function Autocomplete(props: AutocompleteProps) {
  const [suggestions, setSuggestions] = createSignal<any[]>([]);
  const [isVisible, setIsVisible] = createSignal(false);
  
  createEffect(() => {
    if (props.input.startsWith('/')) {
      const command = props.input.slice(1).toLowerCase();
      const allSuggestions = getSlashCommandSuggestions();
      
      const filtered = command 
        ? allSuggestions.filter(s => s.label.toLowerCase().includes(command))
        : allSuggestions;
        
      setSuggestions(filtered);
      setIsVisible(filtered.length > 0);
    } else {
      setIsVisible(false);
    }
  });

  // Handle keyboard navigation and selection
  // ... existing implementation ...

  return (
    <div 
      class={`autocomplete ${isVisible() ? 'visible' : 'hidden'}`}
      style={{ left: `${props.position.x}px`, top: `${props.position.y}px` }}
    >
      {suggestions().map((suggestion, index) => (
        <div 
          class="autocomplete-item"
          onClick={() => props.onSelect(suggestion.label)}
        >
          <span class="command">{suggestion.label}</span>
          <span class="description">{suggestion.detail}</span>
          {suggestion.documentation && (
            <span class="shortcut">{suggestion.documentation}</span>
          )}
        </div>
      ))}
    </div>
  );
}