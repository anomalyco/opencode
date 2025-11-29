import React, { useState, useEffect } from 'react';
import { ShimmerText } from './ShimmerText';

interface CommandTextProps {
  baseCommand: string;
  agentName: string;
  agentColor: string;
  className?: string;
  id?: string;
}

export const CommandText: React.FC<CommandTextProps> = ({
  baseCommand,
  agentName: initialAgentName,
  agentColor: initialAgentColor,
  className = '',
  id
}) => {
  const [agentName, setAgentName] = useState(initialAgentName);
  const [agentColor, setAgentColor] = useState(initialAgentColor);

  useEffect(() => {
    const handleUpdateCommand = (event: CustomEvent) => {
      const { agentName: newAgentName, agentColor: newAgentColor } = event.detail;
      setAgentName(newAgentName);
      setAgentColor(newAgentColor);
    };

    window.addEventListener('updateCommandText', handleUpdateCommand as EventListener);

    return () => {
      window.removeEventListener('updateCommandText', handleUpdateCommand as EventListener);
    };
  }, []);

  return (
    <code id={id} className={className}>
      {baseCommand}{' '}
      <ShimmerText color={agentColor}>
        {agentName}
      </ShimmerText>
    </code>
  );
};