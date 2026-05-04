import Link from "next/link";
import { useLocaleStore } from "@/lib/i18n/store";

export default function NotFound() {
  const { t } = useLocaleStore();
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h2 className="text-2xl font-bold">{t("notFound.title")}</h2>
      <p className="mt-2 text-muted-foreground">{t("notFound.desc")}</p>
      <Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
        {t("notFound.back")}
      </Link>
    </div>
  );
}
