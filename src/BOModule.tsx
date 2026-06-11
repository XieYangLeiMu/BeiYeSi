// BOModule.tsx - 贝叶斯优化主动学习模块
import React, { useState, useCallback } from 'react';
import {
  Card, Row, Col, Button, Input, InputNumber, Select, Table, Space, Tag, message,
  Radio, Slider, Switch, Modal, Badge, Divider, Empty, Spin, Tooltip,
} from 'antd';
import {
  RocketOutlined, PlusOutlined, DeleteOutlined, EyeOutlined, ReloadOutlined,
  BarChartOutlined, ThunderboltOutlined, SafetyOutlined,
} from '@ant-design/icons';
import Plot from 'react-plotly.js';
import type { Experiment, BOSettings, Objective, SurfaceData, CandidatePoolData } from './types';

const { Option } = Select;

interface Props {
  experiments: Experiment[];
  boSettings: BOSettings;
  setBoSettings: React.Dispatch<React.SetStateAction<BOSettings>>;
  surfaceData: SurfaceData | null;
  onSurfaceData: (data: SurfaceData) => void;
  onExperimentsUpdate: (exps: Experiment[]) => void;
  onDeleteExperiment: (expId: number) => void;
  onSHAPRequest: (expId: number) => void;
  callAPI: (endpoint: string, method: string, data?: any) => Promise<any>;
  loading: boolean;
}

const BOModule: React.FC<Props> = ({
  experiments, boSettings, setBoSettings, surfaceData, onSurfaceData,
  onExperimentsUpdate, onDeleteExperiment, onSHAPRequest, callAPI, loading,
}) => {
  const [candidatePool, setCandidatePool] = useState<CandidatePoolData | null>(null);
  const [stopModalVisible, setStopModalVisible] = useState(false);
  const [isBatch, setIsBatch] = useState(false);

  // 判断是否满足终止条件
  const checkStopCondition = useCallback(() => {
    const completed = experiments.filter((e) => e.status === 'completed');
    if (completed.length < 3) return false;
    if (boSettings.stopCondition === 'iterations') {
      if (completed.length >= boSettings.maxIterations) {
        setStopModalVisible(true);
        return true;
      }
    } else if (boSettings.stopCondition === 'threshold') {
      const objectives = boSettings.objectives || [];
      for (const obj of objectives) {
        const vals = completed.map((e) => e.objectives[obj.name]).filter((v) => v != null) as number[];
        if (vals.length > 0) {
          const best = obj.type === 'maximize' ? Math.max(...vals) : Math.min(...vals);
          if (obj.target != null && ((obj.type === 'maximize' && best >= obj.target) || (obj.type === 'minimize' && best <= obj.target))) {
            setStopModalVisible(true);
            return true;
          }
        }
      }
    }
    return false;
  }, [experiments, boSettings]);

  // 生成新实验
  const handleSuggest = async () => {
    const result = await callAPI('bo/suggest', 'POST', { experiments, settings: boSettings });
    if (result && result.data) {
      const newExp: Experiment = {
        id: Date.now(),
        batch: experiments.length + 1,
        variables: result.data.variables,
        objectives: boSettings.objectives.reduce((acc, obj) => ({ ...acc, [obj.name]: null }), {}),
        source: 'BO',
        status: 'pending',
        timestamp: new Date().toISOString(),
      };
      const updated = [...experiments, newExp];
      onExperimentsUpdate(updated);
      message.success('已生成新实验方案（淡黄色高亮行）');
      checkStopCondition();
    }
  };

  // 批量采样
  const handleBatchSuggest = async () => {
    const result = await callAPI('bo/batch-suggest', 'POST', { experiments, settings: { ...boSettings, batchSize: boSettings.batchSize } });
    if (result && result.data) {
      const newExps: Experiment[] = result.data.map((item: any, i: number) => ({
        id: Date.now() + i,
        batch: experiments.length + i + 1,
        variables: item.variables,
        objectives: boSettings.objectives.reduce((acc, obj) => ({ ...acc, [obj.name]: null }), {}),
        source: 'BO' as const,
        status: 'pending' as const,
        timestamp: new Date().toISOString(),
      }));
      const updated = [...experiments, ...newExps];
      onExperimentsUpdate(updated);
      message.success(`已生成 ${newExps.length} 个批量实验方案`);
    }
  };

  // 生成候选池
  const handleCandidates = async () => {
    const result = await callAPI('bo/candidates', 'POST', { experiments, settings: boSettings });
    if (result && result.data) {
      setCandidatePool(result.data);
      message.success('候选池已生成');
    }
  };

  // 生成响应面
  const handleSurface = async () => {
    const result = await callAPI('bo/surface', 'POST', { experiments, settings: boSettings });
    if (result && result.data) {
      onSurfaceData(result.data);
      message.success('响应面已生成');
    } else {
      const errDetail = result?.error || '请检查是否已有足够实验数据并启动后端服务';
      message.error(`生成响应面失败：${errDetail}`);
    }
  };

  // 更新实验结果
  const updateResult = async (id: number, objName: string, value: number) => {
    const exp = experiments.find((e) => e.id === id);
    if (!exp) return;
    const newObjectives = { ...exp.objectives, [objName]: value };
    await callAPI(`experiments/${id}`, 'PUT', { objectives: newObjectives });
    const updated = experiments.map((e) =>
      e.id === id ? { ...e, objectives: newObjectives, status: 'completed' as const } : e
    );
    onExperimentsUpdate(updated);
    message.success('实验结果已更新');
  };

  // 动态表格列
  const dataColumns = [
    {
      title: '标记', key: 'flag', width: 40, fixed: 'left' as const,
      render: (_: any, record: Experiment) => (
        (record.source === 'LHS' || record.source === 'BO')
          ? (
            <svg width="16" height="18" viewBox="0 0 16 18" style={{ display: 'block' }}>
              <rect x="6" y="1" width="2" height="16" rx="0.8" fill="#999" />
              <polygon points="8,2 14,5.5 8,9" fill="#e74c3c"
                stroke="rgba(231,76,60,0.5)" strokeWidth="0.5"
              />
            </svg>
          ) : null
      ),
    },
    { title: '批次', dataIndex: 'batch', key: 'batch', width: 60, fixed: 'left' as const },
    ...(experiments.length > 0
      ? Object.keys(experiments[0].variables).map((vname) => ({
        title: vname,
        key: vname,
        width: 100,
        render: (_: any, record: Experiment) => String(record.variables[vname] ?? '-'),
      }))
      : []),
    ...((boSettings.objectives || []).map((obj) => ({
      title: obj.name + (obj.type === 'maximize' ? ' ↑' : ' ↓'),
      key: obj.name,
      width: 130,
      render: (_: any, record: Experiment) => {
        const val = record.objectives[obj.name];
        if (val != null) return <span>{Number(val).toFixed(2)}</span>;
        if (record.status === 'completed') return <span>-</span>;
        return (
          <InputNumber
            size="small"
            placeholder="输入"
            step={0.1}
            style={{ width: 80 }}
            onBlur={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) updateResult(record.id, obj.name, v);
            }}
          />
        );
      },
    }))),
    {
      title: '来源', key: 'source', width: 70,
      render: (_: any, record: Experiment) => (
        <Tag color={record.source === 'BO' ? 'blue' : 'green'}>{record.source}</Tag>
      ),
    },
    {
      title: '状态', key: 'status', width: 80,
      render: (_: any, record: Experiment) => (
        <Badge status={record.status === 'completed' ? 'success' : 'warning'}
          text={record.status === 'completed' ? '已完成' : '待实验'} />
      ),
    },
    {
      title: '操作', key: 'action', width: 130, fixed: 'right' as const,
      render: (_: any, record: Experiment) => (
        <Space size="small">
          {record.status === 'completed' && (
            <Tooltip title="SHAP 分析">
              <Button type="link" size="small" icon={<BarChartOutlined />}
                onClick={() => onSHAPRequest(record.id)} />
            </Tooltip>
          )}
          <Tooltip title="删除">
            <Button type="text" size="small" danger
              onClick={() => onDeleteExperiment(record.id)}
            >
              ✕
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  // 响应面渲染（深色科技风 + 响应式 + 实验点叠加）
  const renderSurfacePlot = () => {
    if (!surfaceData) return null;

    const COLORSCALE: [number, string][] = [
      [0.0, '#2a0052'], [0.1, '#3b0f6b'], [0.2, '#5c1d8f'],
      [0.3, '#2c5aa0'], [0.4, '#1a8a8a'], [0.5, '#1fa363'],
      [0.6, '#5dc03e'], [0.7, '#a8d838'], [0.8, '#f4e83d'],
      [0.9, '#f4a73d'], [1.0, '#e8452d'],
    ];

    // 从已完成实验中推断变量名
    const completedExps = experiments.filter((e) => e.status === 'completed');
    const numericVarNames = completedExps.length > 0
      ? Object.keys(completedExps[0].variables).filter(
          (k) => typeof completedExps[0].variables[k] === 'number'
        )
      : [];
    const xLabel = numericVarNames[0] || '变量 1';
    const yLabel = numericVarNames[1] || '变量 2';
    const objs = boSettings.objectives || [];
    const zLabel = objs[0]?.name || '响应值';

    const traces: any[] = [
      {
        type: 'surface',
        x: surfaceData.x,
        y: surfaceData.y,
        z: surfaceData.z,
        colorscale: COLORSCALE,
        contours: {
          x: { show: false },
          y: { show: false },
          z: { show: true, usecolormap: true, highlightcolor: 'rgba(255,255,255,0.4)', project: { z: false } },
        },
        opacity: 0.92,
        showscale: true,
        colorbar: {
          thickness: 12,
          tickfont: { color: '#888', size: 9 },
          title: { text: zLabel, font: { color: '#aaa', size: 10 } },
          bgcolor: 'rgba(0,0,0,0)',
          outlinecolor: '#2a2a2a',
          bordercolor: '#2a2a2a',
          len: 0.8,
        },
        name: 'GP 预测',
        hovertemplate: `${xLabel}: %{x:.3f}<br>${yLabel}: %{y:.3f}<br>${zLabel}: %{z:.3f}<extra></extra>`,
      },
    ];

    // 叠加已完成实验点（需要至少 2 个变量 + 1 个目标值）
    if (numericVarNames.length >= 2 && objs.length > 0) {
      const pts = completedExps
        .map((e) => ({
          x: Number(e.variables[numericVarNames[0]] ?? 0),
          y: Number(e.variables[numericVarNames[1]] ?? 0),
          z: typeof e.objectives[objs[0].name] === 'number' ? Number(e.objectives[objs[0].name]) : null,
          batch: e.batch,
        }))
        .filter((p): p is { x: number; y: number; z: number; batch: number } => p.z !== null);

      if (pts.length > 0) {
        traces.push({
          type: 'scatter3d',
          mode: 'markers+text',
          x: pts.map((p) => p.x),
          y: pts.map((p) => p.y),
          z: pts.map((p) => p.z),
          text: pts.map((p) => `#${p.batch}`),
          textposition: 'top center',
          textfont: { color: '#fff', size: 10 },
          marker: {
            size: 7,
            color: '#ff6b6b',
            symbol: 'circle',
            line: { color: '#fff', width: 1 },
          },
          name: '实验点',
          hovertemplate: `批次 #%{text}<br>${xLabel}: %{x:.3f}<br>${yLabel}: %{y:.3f}<br>${zLabel}: %{z:.3f}<extra></extra>`,
        });
      }
    }

    return (
      <div style={{ width: '100%', height: 440 }}>
        <Plot
          data={traces}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#ccc', size: 10 },
            margin: { l: 0, r: 0, t: 10, b: 0 },
            scene: {
              bgcolor: '#0c0c0c',
              xaxis: {
                title: { text: xLabel, font: { color: '#ccc', size: 11 } },
                tickfont: { size: 9, color: '#888' },
                gridcolor: '#2a2a2a',
                backgroundcolor: 'rgba(20,20,20,0.6)',
                showbackground: true,
              },
              yaxis: {
                title: { text: yLabel, font: { color: '#ccc', size: 11 } },
                tickfont: { size: 9, color: '#888' },
                gridcolor: '#2a2a2a',
                backgroundcolor: 'rgba(20,20,20,0.6)',
                showbackground: true,
              },
              zaxis: {
                title: { text: zLabel, font: { color: '#ccc', size: 11 } },
                tickfont: { size: 9, color: '#888' },
                gridcolor: '#2a2a2a',
                backgroundcolor: 'rgba(20,20,20,0.6)',
                showbackground: true,
              },
              camera: { eye: { x: 1.5, y: -1.8, z: 1.2 } },
              aspectmode: 'cube',
            },
            showlegend: traces.length > 1,
            legend: {
              x: 0.01, y: 0.99,
              bgcolor: 'rgba(20,20,20,0.85)',
              bordercolor: '#333',
              borderwidth: 1,
              font: { color: '#ccc', size: 11 },
            },
            dragmode: 'turntable',
          }}
          config={{
            displayModeBar: true,
            responsive: true,
            displaylogo: false,
            scrollZoom: true,
            modeBarButtonsToRemove: ['sendDataToCloud'],
          }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </div>
    );
  };

  // 帕累托前沿
  const renderParetoFront = () => {
    const completed = experiments.filter((e) => e.status === 'completed');
    const objs = boSettings.objectives || [];
    if (completed.length < 2 || objs.length < 2) {
      return <Empty description="需要至少 2 个已完成实验和 2 个目标" />;
    }
    const data = [{
      type: 'scatter',
      mode: 'markers+text',
      x: completed.map((e) => Number(Object.values(e.objectives).filter((v): v is number => v != null)[0] ?? 0)),
      y: completed.map((e) => Number(Object.values(e.objectives).filter((v): v is number => v != null)[1] ?? 0)),
      text: completed.map((e) => `#${e.batch}`),
      textposition: 'top center',
      marker: {
        size: 10,
        color: completed.map((e) => e.source === 'BO' ? '#e74c3c' : '#3498db'),
        showscale: false,
      },
    }];
    return (
      <Plot
        data={data}
        layout={{
          title: '帕累托前沿',
          xaxis: { title: objs[0]?.name || '目标 1' },
          yaxis: { title: objs[1]?.name || '目标 2' },
          width: 500,
          height: 380,
        }}
      />
    );
  };

  return (
    <div style={{ padding: 24 }}>
      {/* 标题区 */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1a3a5c', margin: 0 }}>
          BO
          <span style={{ fontWeight: 400, fontSize: 14, color: '#666', marginLeft: 12 }}>
            贝叶斯优化主动学习模块
          </span>
        </h2>
        <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>核心人机协同交互 — 高斯过程建模 + 采集函数，智能推荐下一轮实验方案</p>
      </div>

      <Row gutter={[16, 16]}>
        {/* 左侧：优化设置 */}
        <Col xs={24} lg={12}>
          <Card size="small" title={<span style={{ color: '#1a3a5c' }}>优化模式与目标</span>} style={{ borderColor: '#d9e8f5', marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Radio.Group value={boSettings.mode} onChange={(e) => setBoSettings({ ...boSettings, mode: e.target.value, objectives: e.target.value === 'single' ? [boSettings.objectives[0]] : boSettings.objectives })}>
                <Radio value="single">单目标优化</Radio>
                <Radio value="multi">多目标优化</Radio>
              </Radio.Group>
              <Divider style={{ margin: '8px 0' }} />
              {(boSettings.objectives || []).map((obj, idx) => (
                <Space key={idx} style={{ marginBottom: 6, width: '100%' }}>
                  <Input value={obj.name} onChange={(e) => {
                    const objs = [...boSettings.objectives];
                    objs[idx] = { ...objs[idx], name: e.target.value };
                    setBoSettings({ ...boSettings, objectives: objs });
                  }} style={{ width: 110 }} size="small" />
                  <Select value={obj.type} onChange={(v) => {
                    const objs = [...boSettings.objectives];
                    objs[idx] = { ...objs[idx], type: v };
                    setBoSettings({ ...boSettings, objectives: objs });
                  }} style={{ width: 90 }} size="small">
                    <Option value="maximize">最大化</Option>
                    <Option value="minimize">最小化</Option>
                  </Select>
                  <InputNumber placeholder="权重" value={obj.weight} onChange={(v) => {
                    const objs = [...boSettings.objectives];
                    objs[idx] = { ...objs[idx], weight: v ?? 1 };
                    setBoSettings({ ...boSettings, objectives: objs });
                  }} style={{ width: 65 }} size="small" />
                  <InputNumber placeholder="目标值" value={obj.target} onChange={(v) => {
                    const objs = [...boSettings.objectives];
                    objs[idx] = { ...objs[idx], target: v ?? undefined };
                    setBoSettings({ ...boSettings, objectives: objs });
                  }} style={{ width: 80 }} size="small" />
                  {boSettings.mode !== 'single' && <Button icon={<DeleteOutlined />} size="small" onClick={() => {
                    setBoSettings({ ...boSettings, objectives: boSettings.objectives.filter((_, i) => i !== idx) });
                  }} />}
                </Space>
              ))}
              {boSettings.mode !== 'single' && <Button size="small" icon={<PlusOutlined />} onClick={() => {
                setBoSettings({
                  ...boSettings,
                  objectives: [...boSettings.objectives, { name: '新目标', type: 'maximize', weight: 1 }],
                });
              }}>添加目标</Button>}
            </Space>
          </Card>

          <Card size="small" title={<span style={{ color: '#1a3a5c' }}>代理模型配置</span>} style={{ borderColor: '#d9e8f5' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space>
                <span style={{ width: 80 }}>核函数:</span>
                <Select value={boSettings.kernel} onChange={(v) => setBoSettings({ ...boSettings, kernel: v })} style={{ width: 180 }}>
                  <Option value="matern52">Matérn 5/2 (默认)</Option>
                  <Option value="rbf">RBF 径向基函数</Option>
                  <Option value="auto">自动选择</Option>
                </Select>
              </Space>
              <Space>
                <span style={{ width: 80 }}>非参数模型:</span>
                <Select value={boSettings.surrogate} onChange={(v) => setBoSettings({ ...boSettings, surrogate: v })} style={{ width: 180 }}>
                  <Option value="">无 (仅 GP)</Option>
                  <Option value="rf">RF 随机森林</Option>
                  <Option value="tpe">TPE</Option>
                </Select>
              </Space>
            </Space>
          </Card>
        </Col>

        {/* 右侧：采样策略 */}
        <Col xs={24} lg={12}>
          <Card size="small" title={<span style={{ color: '#1a3a5c' }}>采样策略</span>} style={{ borderColor: '#d9e8f5', marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space>
                <span style={{ width: 80 }}>单点/批量:</span>
                <Switch checked={isBatch} onChange={(v) => setIsBatch(v)} checkedChildren="批量" unCheckedChildren="单点" />
                {isBatch && (
                  <>
                    <span>批量大小:</span>
                    <InputNumber min={1} max={10} value={boSettings.batchSize}
                      onChange={(v) => setBoSettings({ ...boSettings, batchSize: v ?? 1 })} style={{ width: 60 }} size="small" />
                  </>
                )}
              </Space>
              <Space>
                <span style={{ width: 80 }}>采集函数:</span>
                <Select
                  value={boSettings.acquisition}
                  onChange={(v) => setBoSettings({ ...boSettings, acquisition: v })}
                  style={{ width: 180 }}
                >
                  {!isBatch ? (
                    <>
                      <Option value="EI">Expected Improvement (EI)</Option>
                      <Option value="PI">Probability of Improvement (PI)</Option>
                      <Option value="UCB">Upper Confidence Bound (UCB)</Option>
                    </>
                  ) : (
                    <>
                      <Option value="qEI">q-EI (Kriging Believer)</Option>
                      <Option value="qUCB">q-UCB</Option>
                      <Option value="thompson">Thompson Sampling</Option>
                    </>
                  )}
                </Select>
              </Space>
              <Space style={{ width: '100%' }}>
                <span style={{ width: 80 }}>利用 ↔ 探索:</span>
                <Slider
                  value={boSettings.explorationRate}
                  onChange={(v) => setBoSettings({ ...boSettings, explorationRate: v })}
                  min={0} max={1} step={0.01}
                  marks={{ 0: '利用', 0.5: '平衡', 1: '探索' }}
                  style={{ width: 240 }}
                />
              </Space>
            </Space>
          </Card>

          {/* 操作按钮 */}
          <Card size="small" style={{ borderColor: '#d9e8f5', marginBottom: 16 }}>
            <Space wrap>
              <Button type="primary" icon={<RocketOutlined />} onClick={isBatch ? handleBatchSuggest : handleSuggest} loading={loading}>
                {isBatch ? `生成 ${boSettings.batchSize} 个新实验` : '生成新实验'}
              </Button>
              <Button icon={<ThunderboltOutlined />} onClick={handleCandidates} loading={loading}>
                候选池
              </Button>
              <Button icon={<EyeOutlined />} onClick={handleSurface} loading={loading}>
                生成响应面
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => {
                const completed = experiments.filter((e) => e.status === 'completed');
                onExperimentsUpdate(completed);
                message.success('已重置待实验行');
              }}>
                重置待实验
              </Button>
            </Space>
          </Card>

          {/* 候选池展示 */}
          {candidatePool && (
            <Card size="small" title="候选池" extra={
              <Tag color="blue">top EI: {candidatePool.topAcquisition.toFixed(3)}</Tag>
            } style={{ borderColor: '#b7eb8f', marginBottom: 16 }}>
              {candidatePool.candidates.map((c, i) => (
                <Row key={i} gutter={[8, 8]} style={{
                  padding: '6px 0',
                  borderBottom: i < candidatePool.candidates.length - 1 ? '1px solid #f0f0f0' : undefined,
                }}>
                  <Col span={10}>
                    <Space size={2}>
                      <Tag color="blue">#{i + 1}</Tag>
                      {Object.entries(c.variables).map(([k, v]) => (
                        <span key={k} style={{ fontSize: 12 }}>{k}={v} </span>
                      ))}
                    </Space>
                  </Col>
                  <Col span={6}>
                    <Tooltip title="期望改进">
                      <span style={{ fontSize: 12, color: '#52c41a' }}>EI={c.expectedImprovement.toFixed(3)}</span>
                    </Tooltip>
                  </Col>
                  <Col span={4}>
                    <Tag color={c.riskScore > 0.7 ? 'red' : c.riskScore > 0.3 ? 'orange' : 'green'}>
                      {c.riskScore > 0.7 ? '高风险' : c.riskScore > 0.3 ? '中风险' : '低风险'}
                    </Tag>
                  </Col>
                  <Col span={4}>
                    <Button size="small" type="link" onClick={() => {
                      const newExp: Experiment = {
                        id: Date.now(), batch: experiments.length + 1, variables: c.variables,
                        objectives: boSettings.objectives.reduce((acc, obj) => ({ ...acc, [obj.name]: null }), {}),
                        source: 'BO', status: 'pending', timestamp: new Date().toISOString(),
                      };
                      onExperimentsUpdate([...experiments, newExp]);
                    }}>选用</Button>
                  </Col>
                </Row>
              ))}
            </Card>
          )}
        </Col>
      </Row>

      {/* 数据池表格 */}
      <Card
        size="small"
        title={<span style={{ color: '#1a3a5c' }}>数据池动态表格</span>}
        style={{ borderColor: '#d9e8f5', marginTop: 16 }}
        extra={
          <Tag>{experiments.filter((e) => e.status === 'completed').length} 已完成 / {experiments.length} 总计</Tag>
        }
      >
        {experiments.length === 0 ? (
          <Empty description="暂无数据，请先在 LHS 模块生成实验方案" />
        ) : (
          <Table
            dataSource={experiments}
            columns={dataColumns}
            rowKey="id"
            scroll={{ x: 800 }}
            pagination={{ pageSize: 10, size: 'small' }}
            size="small"
            rowClassName={(record) =>
              record.source === 'BO' && record.status === 'pending' ? 'bo-pending-row' : ''
            }
          />
        )}
        <style>{`
          .bo-pending-row { background-color: #fffbe6 !important; }
          .bo-pending-row:hover { background-color: #fff1b8 !important; }
        `}</style>
      </Card>

      {/* 可视化区 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card size="small" title={<span style={{ color: '#1a3a5c' }}>响应曲面</span>}>
            {surfaceData ? renderSurfacePlot() : (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Empty description="点击「生成响应面」按钮查看曲面图" />
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title={<span style={{ color: '#1a3a5c' }}>帕累托前沿</span>}>
            {boSettings.mode === 'multi' ? renderParetoFront() : (
              <Empty description="多目标优化模式下自动显示" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 终止条件设置 */}
      <Card size="small" title={<span style={{ color: '#1a3a5c' }}>终止条件</span>}
        style={{ borderColor: '#d9e8f5', marginTop: 16 }}>
        <Space>
          <span>条件:</span>
          <Select value={boSettings.stopCondition}
            onChange={(v) => setBoSettings({ ...boSettings, stopCondition: v })}
            style={{ width: 140 }}>
            <Option value="iterations">迭代次数</Option>
            <Option value="improvement">收敛判断</Option>
            <Option value="threshold">目标阈值</Option>
          </Select>
          {boSettings.stopCondition === 'iterations' && (
            <>
              <span>最大迭代:</span>
              <InputNumber min={1} max={500} value={boSettings.maxIterations}
                onChange={(v) => setBoSettings({ ...boSettings, maxIterations: v ?? 100 })}
                style={{ width: 70 }} size="small" />
            </>
          )}
          {boSettings.stopCondition === 'improvement' && (
            <>
              <span>改进阈值:</span>
              <InputNumber min={0.0001} max={0.1} step={0.001} value={boSettings.improvementThreshold}
                onChange={(v) => setBoSettings({ ...boSettings, improvementThreshold: v ?? 0.01 })}
                style={{ width: 80 }} size="small" />
            </>
          )}
        </Space>
      </Card>

      {/* 建议终止弹窗 */}
      <Modal
        title={<Space><SafetyOutlined style={{ color: '#faad14' }} />优化建议</Space>}
        open={stopModalVisible}
        onOk={() => setStopModalVisible(false)}
        onCancel={() => setStopModalVisible(false)}
        okText="确认"
        cancelText="继续优化"
      >
        <p>检测到已达到设定的终止条件，建议停止本轮贝叶斯优化。</p>
        <p>您可以继续实验以获取更多数据，或切换至 SHAP 模块分析已完成实验的特征重要性。</p>
      </Modal>
    </div>
  );
};

export default BOModule;
