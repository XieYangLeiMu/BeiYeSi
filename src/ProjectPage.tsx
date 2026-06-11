import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Modal, Spin, Empty, message, Typography } from 'antd';
import { PlusOutlined, FolderOpenOutlined, ExperimentOutlined, DeleteOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useAuth } from './AuthContext';
import { Project } from './types';

const { Text, Title } = Typography;

interface ProjectPageProps {
  onOpenProject: (project: Project) => void;
}

const ProjectPage: React.FC<ProjectPageProps> = ({ onOpenProject }) => {
  const { token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token]);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/projects', { headers: headers() });
      const json = await res.json();
      if (json.success) {
        setProjects(json.data || []);
      }
    } catch {
      message.error('加载项目列表失败');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      message.warning('请输入项目名称');
      return;
    }
    try {
      setCreating(true);
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        message.success('项目创建成功');
        setCreateModalOpen(false);
        setNewName('');
        setNewDesc('');
        fetchProjects();
        onOpenProject(json.data as Project);
      } else {
        message.error(json.detail || '创建失败');
      }
    } catch {
      message.error('创建项目失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    Modal.confirm({
      title: '删除项目',
      content: `确定要删除项目「${project.name}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      styles: {
        mask: { background: 'rgba(0,0,0,0.7)' },
        content: { background: '#141414', border: '1px solid #2a2a2a' },
      },
      onOk: async () => {
        try {
          const res = await fetch(`/api/projects/${project.id}`, {
            method: 'DELETE',
            headers: headers(),
          });
          const json = await res.json();
          if (json.success) {
            message.success('项目已删除');
            fetchProjects();
          }
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  const handleOpen = (project: Project) => {
    onOpenProject(project);
  };

  // 格式化日期
  const fmtDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0f',
      color: '#ccc',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '60px 20px',
    }}>
      {/* 头部 */}
      <div style={{ textAlign: 'center', marginBottom: 40, maxWidth: 600 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: '#e0e0e0', marginBottom: 8, letterSpacing: 1 }}>
          <ExperimentOutlined style={{ color: '#4a9bd9', marginRight: 12 }} />
          EDBO · SHAP Lab
        </div>
        <Text style={{ color: '#666', fontSize: 14 }}>贝叶斯优化实验设计平台</Text>
      </div>

      {/* 操作栏 */}
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Title level={4} style={{ color: '#ccc', margin: 0, fontSize: 16 }}>我的项目</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateModalOpen(true)}
          style={{
            background: '#4a9bd9', border: 'none',
            borderRadius: 6, fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          新建项目
        </Button>
      </div>

      {/* 项目列表 */}
      <Spin spinning={loading} style={{ width: '100%', maxWidth: 720 }}>
        {!loading && projects.length === 0 ? (
          <div style={{
            background: '#111', borderRadius: 12, border: '1px solid #222',
            padding: '80px 20px', textAlign: 'center',
          }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<span style={{ color: '#555' }}>暂无项目，点击上方「新建项目」开始</span>}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {projects.map((p) => {
              const expCount = p.state?.experiments?.length ?? 0;
              return (
                <div
                  key={p.id}
                  onClick={() => handleOpen(p)}
                  style={{
                    background: '#111', borderRadius: 12, border: '1px solid #222',
                    padding: '16px 20px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    transition: 'all 0.2s',
                    userSelect: 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#333';
                    e.currentTarget.style.background = '#141414';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#222';
                    e.currentTarget.style.background = '#111';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#e0e0e0', marginBottom: 4 }}>
                      <FolderOpenOutlined style={{ color: '#4a9bd9', marginRight: 8, fontSize: 14 }} />
                      {p.name}
                    </div>
                    {p.description && (
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.description}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span><ClockCircleOutlined style={{ marginRight: 4 }} />{fmtDate(p.updated_at)}</span>
                      <span>实验: {expCount} 组</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16, flexShrink: 0 }}>
                    <Button
                      type="text"
                      icon={<FolderOpenOutlined />}
                      style={{ color: '#4a9bd9', fontSize: 13 }}
                      onClick={(e) => { e.stopPropagation(); handleOpen(p); }}
                    >
                      打开
                    </Button>
                    <Button
                      type="text"
                      icon={<DeleteOutlined />}
                      danger
                      style={{ fontSize: 13 }}
                      onClick={(e) => handleDelete(p, e)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Spin>

      {/* 新建项目对话框 */}
      <Modal
        title={<span style={{ color: '#ccc' }}>新建项目</span>}
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); setNewName(''); setNewDesc(''); }}
        footer={null}
        width={440}
        styles={{
          mask: { background: 'rgba(0,0,0,0.7)' },
          content: { background: '#141414', border: '1px solid #2a2a2a' },
          header: { background: 'transparent', borderBottom: '1px solid #222', paddingBottom: 16 },
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>项目名称 <span style={{ color: '#e74c3c' }}>*</span></div>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="输入项目名称"
              onPressEnter={handleCreate}
              style={{
                background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#ccc',
                borderRadius: 6, height: 38, fontSize: 13,
              }}
            />
          </div>
          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>项目描述</div>
            <Input.TextArea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="可选：输入项目描述"
              rows={3}
              style={{
                background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#ccc',
                borderRadius: 6, fontSize: 13, resize: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Button
              onClick={() => { setCreateModalOpen(false); setNewName(''); setNewDesc(''); }}
              style={{
                background: '#1a1a1a', border: '1px solid #333', color: '#888',
                borderRadius: 6,
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              loading={creating}
              onClick={handleCreate}
              style={{
                background: '#4a9bd9', border: 'none',
                borderRadius: 6,
              }}
            >
              创建并打开
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ProjectPage;
