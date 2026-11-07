import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import TermsModal from "@/components/terms-modal";
import AnnouncementBanner from "@/components/announcement-banner";
import { createClient } from "@supabase/supabase-js";

export const metadata: Metadata = {
  title: "Research Automation Engine",
  description: "AI-powered industry research and custom Cursor prompts",
};

async function getBannerConfig(): Promise<{ enabled: boolean; message: string }> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'announcement_banner')
      .single();
    return (data?.config_value as { enabled: boolean; message: string }) ?? { enabled: false, message: '' };
  } catch {
    return { enabled: false, message: '' };
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const nonce = headersList.get('x-nonce') || '';
  const banner = await getBannerConfig();

  return (
    <html lang="en">
      <head>
        {nonce && <meta property="csp-nonce" content={nonce} />}
      </head>
      <body className="antialiased">
        <AnnouncementBanner enabled={banner.enabled} message={banner.message} />
        {children}
        <TermsModal />
      </body>
    </html>
  );
}

