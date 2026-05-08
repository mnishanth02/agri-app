import * as React from 'react';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onResend?: () => void;
  disabled?: boolean;
}

export function OtpInput({ value, onChange, onResend, disabled }: OtpInputProps) {
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleResend = () => {
    if (!onResend) return;
    onResend();
    setCooldown(30);
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      <InputOTP
        maxLength={6}
        value={value}
        onChange={onChange}
        disabled={disabled}
        containerClassName="justify-center"
      >
        <InputOTPGroup className="gap-2">
          <InputOTPSlot index={0} className="size-12 rounded-md border-l text-base" />
          <InputOTPSlot index={1} className="size-12 rounded-md border-l text-base" />
          <InputOTPSlot index={2} className="size-12 rounded-md border-l text-base" />
          <InputOTPSlot index={3} className="size-12 rounded-md border-l text-base" />
          <InputOTPSlot index={4} className="size-12 rounded-md border-l text-base" />
          <InputOTPSlot index={5} className="size-12 rounded-md border-l text-base" />
        </InputOTPGroup>
      </InputOTP>

      {onResend && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          disabled={cooldown > 0 || disabled}
          onClick={handleResend}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </Button>
      )}
    </div>
  );
}
