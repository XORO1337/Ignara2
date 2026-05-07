"use client";

import { useMemo } from "react";
import { useToastStore } from "../store/toast-store";
import { Snackbar, Alert, Box } from "@mui/material";

export function ToastFeed() {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  const orderedToasts = useMemo(
    () => [...toasts].sort((left, right) => left.createdAt - right.createdAt),
    [toasts],
  );

  if (orderedToasts.length === 0) {
    return null;
  }

  return (
    <Box sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1400, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {orderedToasts.map((toast) => (
        <Snackbar
          key={toast.id}
          open={true}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          autoHideDuration={5000}
          onClose={() => removeToast(toast.id)}
          sx={{ position: 'relative', mb: 1, transform: 'none !important', left: 'auto', right: 'auto', bottom: 'auto' }}
        >
          <Alert
            onClose={() => removeToast(toast.id)}
            severity={toast.tone === 'neutral' ? 'info' : toast.tone}
            variant="filled"
            sx={{ width: '100%', minWidth: 250, boxShadow: 3 }}
          >
            {toast.message}
          </Alert>
        </Snackbar>
      ))}
    </Box>
  );
}
