import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { EmptyState } from "@sirdab/one/components/empty-state";
import { useI18n } from "@/lib/i18n/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="h-full w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent>
          <EmptyState
            size="lg"
            icon={AlertCircle}
            title={t("notFound.title")}
            caption={t("notFound.body")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
