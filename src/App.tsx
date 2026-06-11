// App.tsx - 深色科技风 BO 科研工具主界面（项目级架构）
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ConfigProvider, theme, Tag, Space, Modal, Table, Empty, Divider, message, Button, Tooltip } from 'antd';
import {
  ExperimentOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  UndoOutlined,
  SaveOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { AuthProvider, useAuth } from './AuthContext';
import LoginPage from './LoginPage';
import ProjectPage from './ProjectPage';
import LHSInitialization from './LHSInitialization';
import BOModule from './BOModule';
import SHAPModule from './SHAPModule';
import OverviewPanel from './OverviewPanel';
import axios from 'axios';
import type { Experiment, BOSettings, SHAPValues, SurfaceData, AuditLogEntry, Project, ProjectState, HistoryEntry } from './types';

const API_BASE_URL = '/api';

// 深色科技风主题配置
const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorBgBase: '#0d0d0d',
    colorBgContainer: '#141414',
    colorBgElevated: '#1a1a1a',
    colorBgLayout: '#0a0a0a',
    colorBorder: '#2a2a2a',
    colorBorderSecondary: '#333',
    colorText: '#e8e8e8',
    colorTextSecondary: '#999',
    colorPrimary: '#4a9bd9',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "'Segoe UI', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
  },
};

const defaultBOSettings: BOSettings = {
  mode: 'single',
  objectives: [{ name: '产率', type: 'maximize', weight: 1 }],
  kernel: 'matern52',
  surrogate: '',
  acquisition: 'EI',
  explorationRate: 0.5,
  batchSize: 1,
  batchStrategy: 'qEI',
  maxIterations: 100,
  stopCondition: 'iterations',
  improvementThreshold: 0.01,
};

// 主应用（登录后才显示）
const MainApp: React.FC = () => {
  const { user, logout, isAuthenticated, token } = useAuth();

  if (!isAuthenticated) return <LoginPage />;

  const [activeTab, setActiveTab] = useState('lhs');
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [separationIndex, setSeparationIndex] = useState(-1);
  const MAX_HISTORY = 50;
  const [historyStack, setHistoryStack] = useState<HistoryEntry[]>([]);
  const [boSettings, setBoSettings] = useState<BOSettings>(defaultBOSettings);
  const [surfaceData, setSurfaceData] = useState<SurfaceData | null>(null);
  const [shapData, setShapData] = useState<SHAPValues | null>(null);
  const [loading, setLoading] = useState(false);

  // ===== 项目状态管理 =====
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [showProjectPage, setShowProjectPage] = useState(true);

  // "打开项目" 模态框状态
  const [projectModalVisible, setProjectModalVisible] = useState(false);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  } as Record<string, string>), [token]);

  // ===== 项目操作 =====

  // 保存当前项目
  const saveProject = useCallback(async (showMsg = false) => {
    if (!currentProject) return;
    try {
      const state: ProjectState = {
        experiments,
        historyStack,
        separationIndex,
        boSettings,
        lhsConfig: {},
      };
      const res = await fetch(`/api/projects/${currentProject.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ state }),
      });
      const json = await res.json();
      if (json.success && showMsg) {
        message.success('项目已保存');
      }
      return json.success;
    } catch {
      if (showMsg) message.error('保存失败');
      return false;
    }
  }, [currentProject, experiments, historyStack, separationIndex, boSettings, authHeaders]);

  // 加载项目
  const handleOpenProject = useCallback(async (project: Project) => {
    try {
      const res = await fetch(`/api/projects/${project.id}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.success) {
        const p = json.data as Project;
        setCurrentProject(p);
        setExperiments(p.state.experiments || []);
        // 兼容旧格式 historyStack 迁移（Experiment[][] → HistoryEntry[]）
        const migratedHistory: HistoryEntry[] = (p.state.historyStack || []).map((entry: any) => {
          if (Array.isArray(entry)) {
            return {
              experiments: entry,
              boSettings: { ...defaultBOSettings },
              separationIndex: -1,
            };
          }
          return entry as HistoryEntry;
        });
        setHistoryStack(migratedHistory);
        setSeparationIndex(p.state.separationIndex ?? -1);
        if (p.state.boSettings && (p.state.boSettings as BOSettings).objectives) {
          setBoSettings({ ...defaultBOSettings, ...(p.state.boSettings as any) });
        }
        setSurfaceData(null);
        setShapData(null);
        setActiveTab('lhs');
        setShowProjectPage(false);
      }
    } catch {
      message.error('加载项目失败');
    }
  }, [authHeaders]);

  // 返回项目列表页
  const handleBackToProjects = async () => {
    if (currentProject && experiments.length > 0) {
      await saveProject(true);
    }
    setCurrentProject(null);
    setShowProjectPage(true);
  };

  // "打开项目" 模态框
  const handleShowProjectList = async () => {
    setProjectModalVisible(true);
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/projects', { headers: authHeaders() });
      const json = await res.json();
      if (json.success) setProjectList(json.data || []);
    } catch { /* ignore */ }
    setLoadingProjects(false);
  };

  // 从模态框加载项目
  const handleSelectProject = (project: Project) => {
    if (currentProject && experiments.length > 0) {
      saveProject(false);
    }
    setProjectModalVisible(false);
    handleOpenProject(project);
  };

  // ===== 实验操作 =====

  // 保存快照到历史栈（完整状态快照）
  const pushHistory = useCallback(() => {
    setHistoryStack((prev) => {
      const next = [...prev, { experiments: [...experiments], boSettings: { ...boSettings }, separationIndex }];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  }, [experiments, boSettings, separationIndex]);

  // 包装 setBoSettings：每次修改前自动推历史
  const wrappedSetBoSettings: React.Dispatch<React.SetStateAction<BOSettings>> = useCallback((action) => {
    pushHistory();
    setBoSettings(action);
  }, [pushHistory]);

  // 回退：恢复 experiments + boSettings + separationIndex
  const handleUndo = () => {
    setHistoryStack((prev) => {
      if (prev.length === 0) {
        message.info('没有可回退的历史');
        return prev;
      }
      const last = prev[prev.length - 1];
      setExperiments(last.experiments);
      setBoSettings(last.boSettings);
      setSeparationIndex(last.separationIndex);
      message.success(`已回退到上一步（共 ${last.experiments.length} 条实验）`);
      return prev.slice(0, -1);
    });
  };

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const logsRef = useRef<AuditLogEntry[]>([]);
  const saveProjectRef = useRef(saveProject);
  saveProjectRef.current = saveProject;

  // 页面关闭时自动保存
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentProject) {
        saveProjectRef.current(false);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentProject]);

  const callAPI = async (endpoint: string, method: string, data?: any, isFormData?: boolean) => {
    setLoading(true);
    try {
      const saveToken = localStorage.getItem('edbo_token');
      const headers: Record<string, string> = {};
      if (saveToken) headers['Authorization'] = `Bearer ${saveToken}`;
      if (!isFormData) headers['Content-Type'] = 'application/json';
      const response = await axios({ method, url: `${API_BASE_URL}/${endpoint}`, data, headers });
      return response.data;
    } catch (error: any) {
      const errMsg = error?.response?.data?.detail || error?.message || '未知错误';
      console.error(`API ${method} ${endpoint} 失败:`, errMsg);
      return { success: false, error: errMsg };
    } finally {
      setLoading(false);
    }
  };

  const handleLHSGenerated = (newExps: Experiment[]) => {
    pushHistory();
    setSeparationIndex((prev) => {
      const newIdx = prev < 0 ? experiments.length - 1 : experiments.length;
      return newIdx;
    });
    setExperiments((prev) => [...prev, ...newExps]);
  };

  const handleImportExperiments = (exps: Experiment[]) => {
    pushHistory();
    setExperiments(exps);
  };

  const handleDeleteExperiment = (expId: number) => {
    pushHistory();
    setExperiments((prev) => prev.filter((e) => e.id !== expId));
    message.success('已删除该实验');
  };

  const fetchLogs = useCallback(async () => {
    try {
      const saveToken = localStorage.getItem('edbo_token');
      if (!saveToken) return;
      const res = await axios.get(`${API_BASE_URL}/audit-logs?limit=50`, {
        headers: { Authorization: `Bearer ${saveToken}` },
      });
      if (res.data?.success) {
        const newLogs: AuditLogEntry[] = res.data.data.logs;
        if (JSON.stringify(newLogs) !== JSON.stringify(logsRef.current)) {
          logsRef.current = newLogs;
          setLogs(newLogs);
        }
      }
    } catch {
      // 忽略轮询错误
    }
  }, []);

  // 初始加载 + 5 秒轮询审计日志
  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const actionLabel = (action: string) => {
    const labels: Record<string, string> = {
      login: '用户登录',
      register: '用户注册',
      lhs_generate: 'LHS 实验设计',
      bo_suggest: 'BO 推荐实验',
      bo_batch_suggest: 'BO 批量推荐',
      data_import: '数据导入',
      experiment_update: '更新实验',
      experiment_delete: '删除实验',
    };
    return labels[action] || action;
  };

  const formatLogTime = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('zh-CN', { hour12: false });
    } catch {
      return isoStr;
    }
  };

  const actionDetail = (log: AuditLogEntry) => {
    if (!log.detail || Object.keys(log.detail).length === 0) return '';
    const { count, num_samples, acquisition, kernel, batch_size, var_names } = log.detail;
    const parts: string[] = [];
    if (count) parts.push(`${count} 条`);
    if (num_samples) parts.push(`${num_samples} 样本`);
    if (acquisition) parts.push(acquisition);
    if (kernel) parts.push(`核: ${kernel}`);
    if (batch_size) parts.push(`批量: ${batch_size}`);
    if (var_names?.length) parts.push(`变量: ${var_names.length} 列`);
    return parts.length > 0 ? `— ${parts.join(', ')}` : '';
  };

  const handleBOUpdate = (exps: Experiment[]) => {
    setExperiments(exps);
  };

  const handleSurfaceData = (data: SurfaceData) => {
    setSurfaceData(data);
  };

  const handleSHAPData = (data: SHAPValues) => {
    setShapData(data);
  };

  // 标签页配置
  const tabs = [
    { key: 'lhs', label: '1. LHS 初始设计' },
    { key: 'bo', label: '2. BO 迭代优化' },
    { key: 'shap', label: '3. SHAP 可解释性' },
    { key: 'overview', label: '4. 总览仪表盘' },
  ];

  // 实时日志数据
  const lhsCount = experiments.filter((e) => e.source === 'LHS').length;

  if (!currentProject && !showProjectPage) {
    return <div style={{ background: '#0a0a0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>加载中...</div>;
  }

  // ===== 项目选择页 =====
  if (showProjectPage) {
    return <ProjectPage onOpenProject={handleOpenProject} />;
  }

  return (
    <ConfigProvider theme={darkTheme}>
      <div style={{ height: '100vh', background: '#0a0a0a', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* ====== 顶部标签栏（全宽） ====== */}
        <div style={{
          background: '#0d0d0d', borderBottom: '1px solid #222',
          display: 'flex', alignItems: 'stretch',
          height: 48, flexShrink: 0, padding: '0 16px',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 20, flexShrink: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'linear-gradient(135deg, #333, #555)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ExperimentOutlined style={{ fontSize: 16, color: '#fff' }} />
            </div>
            <span style={{ color: '#fff', fontSize: 15, fontWeight: 700, letterSpacing: 0.5 }}>BO 工具</span>
          </div>

          {/* 标签页 */}
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <div
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '0 20px',
                  display: 'flex', alignItems: 'center',
                  cursor: 'pointer',
                  background: isActive ? '#1a1a1a' : 'transparent',
                  border: isActive ? '1px solid #333' : '1px solid transparent',
                  borderBottom: isActive ? '1px solid #1a1a1a' : '1px solid transparent',
                  marginBottom: -1,
                  borderRadius: '6px 6px 0 0',
                  transition: 'all 0.2s',
                  position: 'relative',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#161616'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  color: isActive ? '#fff' : '#666',
                  fontSize: 13, fontWeight: isActive ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}>
                  {tab.label}
                </span>
                {isActive && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: '20%', right: '20%',
                    height: 2, background: '#4a9bd9', borderRadius: '2px 2px 0 0',
                  }} />
                )}
              </div>
            );
          })}

          {/* 右侧用户信息 */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ color: '#555', fontSize: 11 }}>项目:</span>
            <span style={{ color: '#4a9bd9', fontSize: 12, fontWeight: 600 }}>
              {currentProject?.name || '未命名'}
            </span>
            <Divider type="vertical" style={{ borderColor: '#222', height: 14, margin: '0 4px' }} />
            <span style={{ color: '#888', fontSize: 12 }}>{user?.username}</span>
            <div
              onClick={logout}
              style={{ color: '#666', fontSize: 12, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#e0e0e0'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
            >
              退出登录
            </div>
          </div>
        </div>

        {/* ====== 工具栏 ====== */}
        <div style={{
          background: '#111', borderBottom: '1px solid #222',
          padding: '0 16px', display: 'flex', alignItems: 'center',
          height: 40, gap: 4, flexShrink: 0,
        }}>
          <Button
            type="text"
            icon={<FileAddOutlined />}
            onClick={() => {
              Modal.confirm({
                title: '新建项目',
                content: '当前项目将被保存并返回项目列表，是否继续？',
                okText: '确定',
                cancelText: '取消',
                styles: {
                  mask: { background: 'rgba(0,0,0,0.7)' },
                  content: { background: '#141414', border: '1px solid #2a2a2a' },
                },
                onOk: handleBackToProjects,
              });
            }}
            style={{ color: '#ccc', fontSize: 12, height: 30 }}
          >
            新建项目
          </Button>
          <Button
            type="text"
            icon={<FolderOpenOutlined />}
            onClick={handleShowProjectList}
            style={{ color: '#ccc', fontSize: 12, height: 30 }}
          >
            打开项目
          </Button>
          <Tooltip title="保存当前项目到服务器">
            <Button
              type="text"
              icon={<SaveOutlined />}
              onClick={() => saveProject(true)}
              style={{ color: '#ccc', fontSize: 12, height: 30 }}
            >
              保存
            </Button>
          </Tooltip>
          <Button
            type="text"
            icon={<UndoOutlined />}
            onClick={handleUndo}
            disabled={historyStack.length === 0}
            style={{ color: '#ccc', fontSize: 12, height: 30 }}
          >
            回退 ({historyStack.length})
          </Button>
          <Divider type="vertical" style={{ borderColor: '#222', height: 16, margin: '0 8px' }} />
          <span style={{ color: '#888', fontSize: 11 }}>
            实验: <b style={{ color: '#e0e0e0' }}>{experiments.length} 条</b>
          </span>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip title="返回项目列表">
              <Button
                type="text"
                icon={<RollbackOutlined />}
                onClick={handleBackToProjects}
                style={{ color: '#666', fontSize: 12, height: 30 }}
              />
            </Tooltip>
          </div>
        </div>

        {/* ====== 主体：侧边栏 + 内容 ====== */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* ====== 左侧日志面板 ====== */}
          <div style={{
            width: 260, flexShrink: 0, background: '#111',
            borderRight: '1px solid #222',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* 项目信息 */}
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
              <div style={{ color: '#aaa', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                项目信息
              </div>
              <div style={{ color: '#e0e0e0', fontWeight: 500, fontSize: 13 }}>
                {currentProject?.name || '未命名'}
              </div>
              {currentProject?.description && (
                <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>{currentProject.description}</div>
              )}
            </div>

            {/* 日志列表 */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '10px 16px 0' }}>
              <div style={{ color: '#aaa', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, flexShrink: 0 }}>
                最近日志
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {logs.length === 0 ? (
                  <div style={{ color: '#555', fontSize: 11, textAlign: 'center', padding: '20px 0' }}>暂无日志</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={log.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '5px 0', borderBottom: '1px solid #1a1a1a',
                    }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: i === 0 ? '#4a9bd9' : '#333',
                        marginTop: 4, flexShrink: 0,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: '#4a9bd9', fontSize: 10, fontWeight: 600 }}>
                            {actionLabel(log.action)}
                          </span>
                          <span style={{ color: '#555', fontSize: 9, flexShrink: 0 }}>
                            {formatLogTime(log.created_at)}
                          </span>
                        </div>
                        <div style={{ color: '#888', fontSize: 10 }}>
                          <span>{log.username}</span>
                          {actionDetail(log) && (
                            <span style={{ color: '#666', marginLeft: 4 }}>{actionDetail(log)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 底部状态 */}
            <div style={{
              padding: '12px 16px', borderTop: '1px solid #1a1a1a',
              background: '#0d0d0d', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: '#999' }}>状态:</span>
                <span style={{ color: experiments.length === 0 ? '#555' : '#52c41a', fontWeight: 600 }}>
                  {experiments.length === 0 ? '未配置' : '已配置'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#999' }}>LHS / BO 实验:</span>
                <span style={{ color: '#e0e0e0', fontWeight: 600 }}>
                  {experiments.filter((e) => e.source === 'LHS').length} / {experiments.filter((e) => e.source === 'BO').length}
                </span>
              </div>
            </div>
          </div>

          {/* ====== 主内容区 ====== */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#0a0a0a' }}>
            {activeTab === 'lhs' && (
              <LHSInitialization
                experiments={experiments}
                separationIndex={separationIndex}
                onLHSGenerated={handleLHSGenerated}
                onImportExperiments={handleImportExperiments}
                onDeleteExperiment={handleDeleteExperiment}
                callAPI={callAPI}
                loading={loading}
                onNavigate={setActiveTab}
              />
            )}
            {activeTab === 'bo' && (
              <div style={{ padding: 24 }}>
                <BOModule
                  experiments={experiments}
                  boSettings={boSettings}
                  setBoSettings={wrappedSetBoSettings}
                  surfaceData={surfaceData}
                  onSurfaceData={handleSurfaceData}
                  onExperimentsUpdate={handleBOUpdate}
                  onDeleteExperiment={handleDeleteExperiment}
                  onSHAPRequest={(expId: number) => {
                    callAPI(`shap/analyze/${expId}`, 'GET').then((res) => {
                      if (res) handleSHAPData(res.data);
                    });
                  }}
                  callAPI={callAPI}
                  loading={loading}
                />
              </div>
            )}
            {activeTab === 'shap' && (
              <div style={{ padding: 24 }}>
                <SHAPModule
                  shapData={shapData}
                  experiments={experiments}
                  onRequestSHAP={async () => {
                    const res = await callAPI('shap/beeswarm', 'GET');
                    if (res) handleSHAPData(res.data);
                    return res?.data || null;
                  }}
                  onExperimentSelect={async (expId: number) => {
                    const res = await callAPI(`shap/analyze/${expId}`, 'GET');
                    if (res) handleSHAPData(res.data);
                    return res?.data || null;
                  }}
                  onDeleteExperiment={handleDeleteExperiment}
                  callAPI={callAPI}
                  loading={loading}
                />
              </div>
            )}
            {activeTab === 'overview' && (
              <div style={{ padding: 24 }}>
                <OverviewPanel
                  experiments={experiments}
                  shapData={shapData}
                  surfaceData={surfaceData}
                  boSettings={boSettings}
                  onNavigate={(tab: string) => setActiveTab(tab)}
                  onDeleteExperiment={handleDeleteExperiment}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ====== 打开项目 Modal ====== */}
      <Modal
        title={<span style={{ color: '#ccc' }}>打开项目</span>}
        open={projectModalVisible}
        onCancel={() => setProjectModalVisible(false)}
        footer={null}
        width={680}
        styles={{
          mask: { background: 'rgba(0,0,0,0.7)' },
          content: { background: '#141414', border: '1px solid #2a2a2a' },
        }}
      >
        {loadingProjects ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>加载中...</div>
        ) : projectList.length === 0 ? (
          <Empty
            description={<span style={{ color: '#666' }}>暂无项目，请先新建项目</span>}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Table
            dataSource={projectList}
            rowKey="id"
            pagination={false}
            size="small"
            style={{ background: 'transparent' }}
            onRow={(record) => ({
              onClick: () => handleSelectProject(record),
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: <span style={{ color: '#888', fontSize: 12 }}>项目名称</span>,
                dataIndex: 'name',
                key: 'name',
                render: (v: any) => <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>{v}</span>,
              },
              {
                title: <span style={{ color: '#888', fontSize: 12 }}>描述</span>,
                dataIndex: 'description',
                key: 'description',
                ellipsis: true,
                render: (v: any) => <span style={{ color: '#666', fontSize: 12 }}>{v || '-'}</span>,
              },
              {
                title: <span style={{ color: '#888', fontSize: 12 }}>实验</span>,
                key: 'expCount',
                width: 80,
                render: (_: any, rec: Project) => (
                  <Tag color="#4a9bd9" style={{ fontSize: 10 }}>{rec.state?.experiments?.length || 0} 组</Tag>
                ),
              },
              {
                title: <span style={{ color: '#888', fontSize: 12 }}>更新</span>,
                dataIndex: 'updated_at',
                key: 'updated_at',
                width: 160,
                render: (v: string) => {
                  if (!v) return <span style={{ color: '#555' }}>-</span>;
                  const d = new Date(v);
                  return (
                    <span style={{ color: '#888', fontSize: 11 }}>
                      {d.toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  );
                },
              },
            ]}
          />
        )}
      </Modal>
    </ConfigProvider>
  );
};

// 根组件：AuthProvider 包裹
const App: React.FC = () => (
  <AuthProvider>
    <MainApp />
  </AuthProvider>
);

export default App;
