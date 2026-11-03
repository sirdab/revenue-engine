import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="h-full w-full flex items-center justify-center bg-surface-whisper">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">{t("notFound.title")}</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            {t("notFound.body")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
