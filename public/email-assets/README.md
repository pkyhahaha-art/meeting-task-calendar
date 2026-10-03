# PEA email assets

These public, versioned PNG files are used by the transactional email template.
Their HTTPS URLs are derived from the worker's existing PUBLIC_APP_URL. Publish
GitHub Pages before deploying the worker so Gmail can load the images.

- pea-logo.png: existing project PEA logo, copied without alterations.
- pea-mail-mascot-v1.png: generated using the built-in image_gen tool with
  ภาพประกอบUI/02_Hand I-Pad.jpg as the edit reference, transparent background.

Final image prompt: Replace only the tablet with a white envelope with a purple
flap outline and a small gold lightning seal, held in the same hand. Preserve
the PEA mascot's identity, proportions, happy white face, two gold lightning
antennae, purple suit, white PEA lettering, other hand gesture, clean black
linework and flat shaded 2D style. Center the full body with a little margin on
a transparent background. Keep the envelope legible at 100 pixels. No extra
text, watermark, background or objects.

All email information and actions remain HTML text and links so image blocking
does not prevent reading the notification or opening documents.
