import React from 'react';

export function NeoDlpLogo(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <rect width="1024" height="1024" rx="230" fill="#FF0000" />
            <path d="M512 260 V620" stroke="#FFFFFF" strokeWidth="120" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M320 500 L512 692 L704 500" stroke="#FFFFFF" strokeWidth="120" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}
