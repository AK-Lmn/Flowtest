import React from "react";

interface FlowTestMarkProps {
  className?: string;
  size?: number;
}

export default function FlowTestMark({ className = "", size = 24 }: FlowTestMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={`text-emerald-500 ${className}`}
      aria-hidden="true"
    >
      {/* Browser Frame */}
      <rect
        x="2"
        y="4"
        width="28"
        height="24"
        rx="3"
        fill="currentColor"
        fillOpacity="0.05"
        stroke="currentColor"
        strokeWidth="2"
      />
      {/* Browser Header Bar */}
      <line
        x1="2"
        y1="10"
        x2="30"
        y2="10"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Browser Header Window Controls */}
      <circle cx="6" cy="7" r="1" fill="currentColor" fillOpacity="0.5" />
      <circle cx="9" cy="7" r="1" fill="currentColor" fillOpacity="0.5" />
      <circle cx="12" cy="7" r="1" fill="currentColor" fillOpacity="0.5" />
      
      {/* Flow Nodes and Lines */}
      {/* Node 1 */}
      <circle
        cx="9"
        cy="19"
        r="2"
        fill="currentColor"
      />
      {/* Line 1 -> 2 */}
      <line
        x1="11"
        y1="19"
        x2="17"
        y2="19"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2 2"
      />
      {/* Node 2 */}
      <circle
        cx="19"
        cy="19"
        r="2"
        fill="currentColor"
      />
      {/* Line 2 -> 3 */}
      <line
        x1="20.5"
        y1="17.5"
        x2="23.5"
        y2="14.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Check Mark Ending */}
      <path
        d="M21 14.5L23.5 17L29 11.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
