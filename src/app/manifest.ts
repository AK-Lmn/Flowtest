import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FlowTest",
    short_name: "FlowTest",
    description: "Describe the flow. Watch it prove itself.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0f19",
    theme_color: "#10b981",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
