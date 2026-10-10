import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { LucideIcon, Sparkles, ArrowRight, RefreshCcw } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface EmptyStateProps {
  icon?: LucideIcon | React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  tip?: string;
  badge?: string;
  actionText?: string;
  actionLink?: string;
  onAction?: () => void;
  actionIcon?: LucideIcon | React.ComponentType<{ size?: number; className?: string }>;
  secondaryActionText?: string;
  secondaryActionLink?: string;
  onSecondaryAction?: () => void;
  className?: string;
  compact?: boolean;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  tip,
  badge,
  actionText,
  actionLink,
  onAction,
  actionIcon: ActionIcon = ArrowRight,
  secondaryActionText,
  secondaryActionLink,
  onSecondaryAction,
  className,
  compact = false
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "w-full flex flex-col items-center justify-center text-center",
        compact ? "py-10 px-4" : "py-16 md:py-24 px-6",
        "rounded-3xl border border-white/5 bg-[#0f0f0f]/60 backdrop-blur-md relative overflow-hidden",
        "shadow-[0_8px_32px_rgba(0,0,0,0.3)]",
        className
      )}
    >
      {/* Decorative ambient background blur */}
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Optional Badge */}
      {badge && (
        <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-wide">
          <Sparkles size={13} className="text-blue-400" />
          <span>{badge}</span>
        </div>
      )}

      {/* Icon Container with glowing ring */}
      {Icon && (
        <div className="relative mb-6 group">
          <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-blue-600 to-indigo-600 opacity-30 blur-md group-hover:opacity-50 transition-opacity" />
          <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-3xl bg-[#141414] border border-white/10 flex items-center justify-center text-blue-400 shadow-2xl">
            <Icon size={compact ? 36 : 44} className="text-blue-400 transform transition-transform group-hover:scale-110 duration-300" />
          </div>
        </div>
      )}

      {/* Main Title & Description */}
      <h2 className="text-xl md:text-2xl lg:text-3xl font-extrabold text-white tracking-tight max-w-lg mb-2.5 font-display">
        {title}
      </h2>
      <p className="text-sm md:text-base text-neutral-400 max-w-md leading-relaxed mb-6 font-normal">
        {description}
      </p>

      {/* Helpful Interactive Tip Box */}
      {tip && (
        <div className="max-w-md w-full mb-8 p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 flex items-start gap-3 text-left">
          <div className="p-1 rounded-lg bg-blue-500/10 text-blue-400 shrink-0 mt-0.5">
            <Sparkles size={14} />
          </div>
          <div className="text-xs text-neutral-300 leading-relaxed font-medium">
            <strong className="text-white font-semibold">Tips: </strong>
            {tip}
          </div>
        </div>
      )}

      {/* Interactive Action Buttons */}
      {(actionText || secondaryActionText) && (
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          {actionText && (
            actionLink ? (
              <Link
                to={actionLink}
                className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-6 py-3 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-600/25 group"
              >
                <span>{actionText}</span>
                <ActionIcon size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
            ) : (
              <button
                onClick={onAction}
                className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-6 py-3 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-600/25 group"
              >
                <span>{actionText}</span>
                <ActionIcon size={16} className="transition-transform group-hover:translate-x-1" />
              </button>
            )
          )}

          {secondaryActionText && (
            secondaryActionLink ? (
              <Link
                to={secondaryActionLink}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-white/5 hover:bg-white/10 active:scale-95 text-neutral-300 hover:text-white font-semibold text-sm transition-all border border-white/10"
              >
                <span>{secondaryActionText}</span>
              </Link>
            ) : (
              <button
                onClick={onSecondaryAction}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-white/5 hover:bg-white/10 active:scale-95 text-neutral-300 hover:text-white font-semibold text-sm transition-all border border-white/10"
              >
                <span>{secondaryActionText}</span>
              </button>
            )
          )}
        </div>
      )}
    </motion.div>
  );
}
