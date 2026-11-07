import * as React from "react"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'default' | 'sm' | 'lg'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'default', size = 'default', ...props }, ref) => {
    const baseClasses = "inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-electric disabled:pointer-events-none disabled:opacity-50"
    
    const variants = {
      default: "bg-cyan-electric text-navy-deep hover:shadow-glow-cyan font-semibold",
      outline: "border border-cyan-electric/30 bg-transparent hover:bg-cyan-electric/10 text-cyan-electric hover:border-cyan-electric hover:shadow-glow-cyan backdrop-blur-sm",
      ghost: "hover:bg-white/10 text-white backdrop-blur-sm",
      destructive: "bg-red-600 text-white hover:bg-red-700 shadow-sm"
    }
    
    const sizes = {
      default: "h-10 px-4 py-2",
      sm: "h-8 px-3 text-sm",
      lg: "h-12 px-8 text-lg"
    }
    
    return (
      <button
        className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }

