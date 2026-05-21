import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FolderPlus, Trash2, Edit2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface LinkedProject {
  id: string;
  name: string;
  path: string;
  description?: string;
}

interface Workspace {
  id: string;
  name: string;
  projects: LinkedProject[];
  createdAt: number;
}

interface WorkspaceManagerProps {
  onWorkspaceSelect?: (workspaceId: string | null) => void;
}

export function WorkspaceManager({ onWorkspaceSelect }: WorkspaceManagerProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newProjectPaths, setNewProjectPaths] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWorkspaces();
    
    // Load selected workspace from sessionStorage
    const saved = sessionStorage.getItem("selectedWorkspace");
    if (saved) {
      setSelectedWorkspace(saved);
      onWorkspaceSelect?.(saved);
    }
  }, []);

  const loadWorkspaces = async () => {
    try {
      const result = await window.electron.invoke("workspace:list");
      if (result.success) {
        setWorkspaces(result.workspaces);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim() || !newProjectPaths.trim()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const paths = newProjectPaths.split("\n").map(p => p.trim()).filter(p => p);
      const result = await window.electron.invoke("workspace:create", newWorkspaceName, paths);
      
      if (result.success) {
        await loadWorkspaces();
        setIsCreateDialogOpen(false);
        setNewWorkspaceName("");
        setNewProjectPaths("");
        
        // Auto-select the new workspace
        setSelectedWorkspace(result.workspace.id);
        sessionStorage.setItem("selectedWorkspace", result.workspace.id);
        onWorkspaceSelect?.(result.workspace.id);
      } else {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectWorkspace = (workspaceId: string | null) => {
    setSelectedWorkspace(workspaceId);
    sessionStorage.setItem("selectedWorkspace", workspaceId || "");
    onWorkspaceSelect?.(workspaceId);
  };

  const handleDeleteWorkspace = async (workspaceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm("Are you sure you want to delete this workspace? This will not delete the actual project files.")) {
      return;
    }

    try {
      const result = await window.electron.invoke("workspace:delete", workspaceId);
      if (result.success) {
        if (selectedWorkspace === workspaceId) {
          handleSelectWorkspace(null);
        }
        await loadWorkspaces();
      } else {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGetContext = async (workspaceId: string) => {
    try {
      const result = await window.electron.invoke("workspace:getContext", workspaceId);
      if (result.success) {
        alert(`Workspace Context:\n\n${result.context}`);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">مساحات العمل</h3>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <FolderPlus className="w-4 h-4 mr-2" />
              مساحة عمل جديدة
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>إنشاء مساحة عمل جديدة</DialogTitle>
              <DialogDescription>
                اربط مشاريع متعددة للعمل عليها في نفس الوقت مع سياق مشترك.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">اسم مساحة العمل</Label>
                <Input
                  id="name"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder="مثال: مشروع المتجر الإلكتروني"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="paths">مسارات المشاريع</Label>
                <textarea
                  id="paths"
                  value={newProjectPaths}
                  onChange={(e) => setNewProjectPaths(e.target.value)}
                  placeholder="/path/to/project1&#10;/path/to/project2&#10;/path/to/project3"
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">
                  أدخل مسار كل مشروع في سطر منفصل
                </p>
              </div>
            </div>
            {error && (
              <div className="text-sm text-destructive flex items-center gap-2">
                <XCircle className="w-4 h-4" />
                {error}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={handleCreateWorkspace} disabled={loading}>
                {loading ? "جاري الإنشاء..." : "إنشاء"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {workspaces.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <FolderPlus className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>لا توجد مساحات عمل بعد</p>
              <p className="text-sm">أنشئ مساحة عمل جديدة للبدء</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[400px]">
          <div className="grid gap-4">
            {workspaces.map((workspace) => (
              <Card
                key={workspace.id}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-md",
                  selectedWorkspace === workspace.id && "border-primary ring-1 ring-primary"
                )}
                onClick={() => handleSelectWorkspace(workspace.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {selectedWorkspace === workspace.id && (
                        <CheckCircle2 className="w-5 h-5 text-primary" />
                      )}
                      <CardTitle className="text-lg">{workspace.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGetContext(workspace.id);
                        }}
                      >
                        سياق
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleDeleteWorkspace(workspace.id, e)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription>
                    {workspace.projects.length} مشروع{workspace.projects.length === 1 ? "" : "ات"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {workspace.projects.slice(0, 3).map((project) => (
                      <div key={project.id} className="flex items-center gap-2 text-sm">
                        <FolderPlus className="w-4 h-4 text-muted-foreground" />
                        <span className="truncate">{project.path}</span>
                      </div>
                    ))}
                    {workspace.projects.length > 3 && (
                      <p className="text-xs text-muted-foreground">
                        +{workspace.projects.length - 3} مشاريع أخرى
                      </p>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Badge variant="secondary">
                    {new Date(workspace.createdAt).toLocaleDateString("ar-EG")}
                  </Badge>
                </CardFooter>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {selectedWorkspace && (
        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            <span className="font-medium">
              مساحة العمل النشطة: {workspaces.find(w => w.id === selectedWorkspace)?.name}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSelectWorkspace(null)}
          >
            <XCircle className="w-4 h-4 mr-2" />
            إلغاء التحديد
          </Button>
        </div>
      )}
    </div>
  );
}
