'use client';

import { alpha, createTheme } from '@mui/material/styles';

const lightTokens = {
  primary: '#0f766e',
  primaryAccent: '#0ea5e9',
  secondary: '#f97316',
  background: '#f4f6fb',
  paper: '#ffffff',
  text: '#0f172a',
  textSecondary: '#334155',
};

const darkTokens = {
  primary: '#2dd4bf',
  primaryAccent: '#38bdf8',
  secondary: '#fb923c',
  background: '#0b1120',
  paper: '#0f172a',
  text: '#e2e8f0',
  textSecondary: '#94a3b8',
};

const baseTypography = {
  fontFamily: 'var(--font-space-grotesk), "Segoe UI", sans-serif',
  h1: { fontWeight: 700, letterSpacing: -1.2, fontSize: 'clamp(2.6rem, 2.4vw, 3.6rem)' },
  h2: { fontWeight: 700, letterSpacing: -0.8, fontSize: 'clamp(2rem, 2vw, 2.8rem)' },
  h3: { fontWeight: 700, letterSpacing: -0.5, fontSize: 'clamp(1.6rem, 1.6vw, 2.1rem)' },
  h4: { fontWeight: 700, letterSpacing: -0.4 },
  h5: { fontWeight: 700 },
  h6: { fontWeight: 700 },
  subtitle1: { fontWeight: 600 },
  button: { fontWeight: 600, letterSpacing: 0.2 },
};

const lightBase = createTheme({
  palette: {
    mode: 'light',
    primary: { main: lightTokens.primary },
    secondary: { main: lightTokens.secondary },
    background: { default: lightTokens.background, paper: lightTokens.paper },
    text: { primary: lightTokens.text, secondary: lightTokens.textSecondary },
  },
  typography: baseTypography,
  shape: { borderRadius: 16 },
});

export const lightTheme = createTheme(lightBase, {
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          colorScheme: 'light',
          color: lightBase.palette.text.primary,
        },
        body: {
          backgroundColor: lightBase.palette.background.default,
          backgroundImage: `radial-gradient(1200px 600px at 10% -10%, ${alpha(lightTokens.primaryAccent, 0.18)}, transparent 60%),
            radial-gradient(900px 520px at 100% 0%, ${alpha(lightTokens.secondary, 0.16)}, transparent 55%)`,
          backgroundAttachment: 'fixed',
          color: lightBase.palette.text.primary,
        },
        '::selection': {
          backgroundColor: alpha(lightTokens.primaryAccent, 0.3),
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 14,
          fontWeight: 600,
        },
        contained: {
          backgroundImage: `linear-gradient(135deg, ${lightTokens.primary} 0%, ${lightTokens.primaryAccent} 100%)`,
          boxShadow: `0 12px 30px ${alpha(lightTokens.primary, 0.25)}`,
        },
        outlined: {
          borderColor: alpha(lightTokens.primary, 0.35),
          backgroundColor: alpha(lightTokens.primary, 0.06),
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 20,
          border: `1px solid ${alpha(lightTokens.text, 0.08)}`,
          backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.92))',
          backgroundColor: lightTokens.paper,
          boxShadow: `0 20px 45px ${alpha(lightTokens.primary, 0.08)}`,
          color: lightTokens.text,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 18,
          border: `1px solid ${alpha(lightTokens.text, 0.06)}`,
          backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,248,251,0.94))',
          backgroundColor: lightTokens.paper,
          color: lightTokens.text,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 600,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          backgroundColor: alpha(lightTokens.paper, 0.8),
        },
        notchedOutline: {
          borderColor: alpha(lightTokens.text, 0.12),
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          color: lightTokens.textSecondary,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          color: lightTokens.text,
        },
      },
    },
    MuiTypography: {
      styleOverrides: {
        root: {
          color: 'inherit',
        },
      },
    },
  },
});

const darkBase = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: darkTokens.primary },
    secondary: { main: darkTokens.secondary },
    background: { default: darkTokens.background, paper: darkTokens.paper },
    text: { primary: darkTokens.text, secondary: darkTokens.textSecondary },
  },
  typography: baseTypography,
  shape: { borderRadius: 16 },
});

export const darkTheme = createTheme(darkBase, {
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          colorScheme: 'dark',
          color: darkBase.palette.text.primary,
        },
        body: {
          backgroundColor: darkBase.palette.background.default,
          backgroundImage: `radial-gradient(1200px 600px at 15% -15%, ${alpha(darkTokens.primaryAccent, 0.2)}, transparent 60%),
            radial-gradient(1000px 600px at 90% 0%, ${alpha(darkTokens.secondary, 0.18)}, transparent 60%)`,
          backgroundAttachment: 'fixed',
          color: darkBase.palette.text.primary,
        },
        '::selection': {
          backgroundColor: alpha(darkTokens.primaryAccent, 0.35),
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 14,
          fontWeight: 600,
        },
        contained: {
          backgroundImage: `linear-gradient(135deg, ${darkTokens.primary} 0%, ${darkTokens.primaryAccent} 100%)`,
          boxShadow: `0 18px 45px ${alpha(darkTokens.primary, 0.35)}`,
        },
        outlined: {
          borderColor: alpha(darkTokens.primary, 0.4),
          backgroundColor: alpha(darkTokens.primary, 0.08),
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 20,
          border: `1px solid ${alpha(darkTokens.text, 0.12)}`,
          backgroundImage: 'linear-gradient(180deg, rgba(17,24,39,0.96), rgba(15,23,42,0.92))',
          boxShadow: `0 24px 50px ${alpha('#000000', 0.45)}`,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 18,
          border: `1px solid ${alpha(darkTokens.text, 0.14)}`,
          backgroundImage: 'linear-gradient(180deg, rgba(17,24,39,0.95), rgba(14,20,36,0.92))',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 600,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          backgroundColor: alpha(darkTokens.paper, 0.6),
        },
        notchedOutline: {
          borderColor: alpha(darkTokens.text, 0.2),
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontWeight: 600,
        },
      },
    },
  },
});
