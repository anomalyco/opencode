import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Label } from "./ui/label";
import { Slider } from "./ui/slider";
import { Plus, Trash2, Edit, Save, X } from "lucide-react";
import { useToast } from "./ui/use-toast";
import { ToastAction } from "./ui/toast";

interface Personality {
  id: string;
  name: string;
  description: string;
  traits: string;
  systemPrompt: string;
  temperature?: number;
  model?: string;
}

export function SettingsPersonalities() {
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    traits: "",
    systemPrompt: "",
    temperature: 0.7,
    model: "",
  });

  useEffect(() => {
    loadPersonalities();
  }, []);

  const loadPersonalities = async () => {
    try {
      const list = await window.electron.ipcRenderer.invoke("personality:list");
      setPersonalities(list);
    } catch (error) {
      console.error("فشل تحميل الشخصيات:", error);
      toast({
        title: "خطأ",
        description: "فشل تحميل قائمة الشخصيات",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setFormData({
      name: "",
      description: "",
      traits: "",
      systemPrompt: "",
      temperature: 0.7,
      model: "",
    });
    setEditingId(null);
    setIsCreating(true);
  };

  const handleEdit = (personality: Personality) => {
    setFormData({
      name: personality.name,
      description: personality.description,
      traits: personality.traits,
      systemPrompt: personality.systemPrompt,
      temperature: personality.temperature ?? 0.7,
      model: personality.model ?? "",
    });
    setEditingId(personality.id);
    setIsCreating(false);
  };

  const handleSave = async () => {
    try {
      if (!formData.name.trim()) {
        toast({
          title: "تنبيه",
          description: "اسم الشخصية مطلوب",
          variant: "destructive",
        });
        return;
      }

      if (isCreating) {
        const result = await window.electron.ipcRenderer.invoke("personality:create", formData);
        toast({
          title: "نجاح",
          description: `تم إنشاء شخصية "${formData.name}" بنجاح`,
          action: <ToastAction altText="إغلاق">إغلاق</ToastAction>,
        });
        setEditingId(result.id);
        setIsCreating(false);
      } else if (editingId) {
        await window.electron.ipcRenderer.invoke("personality:update", editingId, formData);
        toast({
          title: "نجاح",
          description: `تم تحديث شخصية "${formData.name}" بنجاح`,
          action: <ToastAction altText="إغلاق">إغلاق</ToastAction>,
        });
        setEditingId(null);
      }

      await loadPersonalities();
      setFormData({
        name: "",
        description: "",
        traits: "",
        systemPrompt: "",
        temperature: 0.7,
        model: "",
      });
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message || "فشل حفظ الشخصية",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`هل أنت متأكد من حذف شخصية "${name}"؟`)) return;

    try {
      await window.electron.ipcRenderer.invoke("personality:delete", id);
      toast({
        title: "نجاح",
        description: `تم حذف شخصية "${name}"`,
        action: <ToastAction altText="إغلاق">إغلاق</ToastAction>,
      });
      await loadPersonalities();
      if (editingId === id) {
        setEditingId(null);
        setIsCreating(false);
        setFormData({
          name: "",
          description: "",
          traits: "",
          systemPrompt: "",
          temperature: 0.7,
          model: "",
        });
      }
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message || "فشل حذف الشخصية",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setIsCreating(false);
    setFormData({
      name: "",
      description: "",
      traits: "",
      systemPrompt: "",
      temperature: 0.7,
      model: "",
    });
  };

  if (loading) {
    return <div className="p-4 text-center">جاري تحميل الشخصيات...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">إدارة الشخصيات</h3>
          <p className="text-sm text-muted-foreground">
            أنشئ وعدّل الشخصيات المخصصة للوكيل
          </p>
        </div>
        <Button onClick={handleCreate} size="sm">
          <Plus className="w-4 h-4 ml-2" />
          إضافة شخصية
        </Button>
      </div>

      {(isCreating || editingId) && (
        <Card>
          <CardHeader>
            <CardTitle>{isCreating ? "إنشاء شخصية جديدة" : `تعديل شخصية`}</CardTitle>
            <CardDescription>
              {isCreating
                ? "أدخل تفاصيل الشخصية الجديدة"
                : "قم بتعديل تفاصيل الشخصية"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">اسم الشخصية</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="مثال: محمد"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">النموذج المفضل (اختياري)</Label>
                <Input
                  id="model"
                  value={formData.model}
                  onChange={(e) =>
                    setFormData({ ...formData, model: e.target.value })
                  }
                  placeholder="مثال: gpt-4"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">وصف الشخصية</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="وصف قصير للشخصة ومتى تُستخدم..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="traits">السمات (افصل بينها بفواصل)</Label>
              <Textarea
                id="traits"
                value={formData.traits}
                onChange={(e) =>
                  setFormData({ ...formData, traits: e.target.value })
                }
                placeholder="مثال: دقيق، مبدع، صبور..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="systemPrompt">System Prompt</Label>
              <Textarea
                id="systemPrompt"
                value={formData.systemPrompt}
                onChange={(e) =>
                  setFormData({ ...formData, systemPrompt: e.target.value })
                }
                placeholder="التعليمات الأساسية للشخصية..."
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="temperature">
                درجة الإبداع (Temperature): {formData.temperature?.toFixed(2)}
              </Label>
              <Slider
                id="temperature"
                value={[formData.temperature ?? 0.7]}
                onValueChange={(values) =>
                  setFormData({ ...formData, temperature: values[0] })
                }
                min={0}
                max={1}
                step={0.01}
              />
              <p className="text-xs text-muted-foreground">
                قيم منخفضة = إجابات أكثر تركيزًا، قيم عالية = إجابات أكثر إبداعًا
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave}>
                <Save className="w-4 h-4 ml-2" />
                حفظ
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                <X className="w-4 h-4 ml-2" />
                إلغاء
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {personalities.map((personality) => (
          <Card key={personality.id} className="relative">
            <CardHeader>
              <CardTitle className="text-lg">{personality.name}</CardTitle>
              <CardDescription className="line-clamp-2">
                {personality.description || "لا يوجد وصف"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium">السمات:</span>
                  <p className="text-muted-foreground line-clamp-2">
                    {personality.traits || "لا توجد سمات محددة"}
                  </p>
                </div>
                {personality.temperature !== undefined && (
                  <div>
                    <span className="font-medium">الإبداع:</span>{" "}
                    {personality.temperature.toFixed(2)}
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(personality)}
                  className="flex-1"
                >
                  <Edit className="w-4 h-4 ml-2" />
                  تعديل
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(personality.id, personality.name)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {personalities.length === 0 && !isCreating && !editingId && (
          <div className="col-span-full text-center py-8 text-muted-foreground">
            لا توجد شخصيات مسجلة. انقر على "إضافة شخصية" للبدء.
          </div>
        )}
      </div>
    </div>
  );
}
