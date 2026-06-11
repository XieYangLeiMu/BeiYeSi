// OverviewPanel.tsx - 总览仪表盘
import React from 'react';
import { Row, Col, Card, Statistic, Tag, Table, Button, Space, Empty, Divider } from 'antd';
import {
  ExperimentOutlined, CheckCircleOutlined, ClockCircleOutlined,
  DatabaseOutlined, LineChartOutlined, PieChartOutlined,
  ThunderboltOutlined, ArrowRightOutlined,
} from '@ant-design/icons';
import type { Experiment, SHAPValues, SurfaceData, BOSettings } from './types';

interface Props {
  experiments: Experiment[];
  shapData: SHAPValues | null;
  surfaceData: SurfaceData | null;
  boSettings: BOSettings;
  onNavigate: (tab: string) => void;
  onDeleteExperiment: (expId: number) => void;
}

const OverviewPanel: React.FC<Props> = ({ experiments, shapData, surfaceData, boSettings, onNavigate, onDeleteExperiment }) => {
  const totalExps = experiments.length;
  const completedExps = experiments.filter((e) => e.status === 'completed').length;
  const pendingExps = experiments.filter((e) => e.status === 'pending').length;
  const lhsCount = experiments.filter((e) => e.source === 'LHS').length;
  const boCount = experiments.filter((e) => e.source === 'BO').length;

  // 最近 5 条实验
  const recentExps = [...experiments].slice(-5).reverse();

  const expColumns = [
    {
      title: '标记', key: 'flag', width: 40,
      render: (_: any, r: Experiment) => (
        (r.source === 'LHS' || r.source === 'BO')
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
    { title: '批次', dataIndex: 'batch', key: 'batch', width: 60 },
    ...(experiments.length > 0
      ? Object.keys(experiments[0].variables).map((v) => ({
        title: v,
        key: v,
        width: 90,
        render: (_: any, r: Experiment) => String(r.variables[v] ?? '-'),
      }))
      : []),
    {
      title: '来源', key: 'source', width: 60,
      render: (_: any, r: Experiment) => (
        <Tag color={r.source === 'BO' ? 'blue' : 'green'}>{r.source}</Tag>
      ),
    },
    {
      title: '状态', key: 'status', width: 70,
      render: (_: any, r: Experiment) => (
        <Tag color={r.status === 'completed' ? 'success' : 'warning'}>
          {r.status === 'completed' ? '已完成' : '待实验'}
        </Tag>
      ),
    },
    {
      title: '操作', key: 'action', width: 50,
      render: (_: any, r: Experiment) => (
        <Button type="text" size="small" danger
          onClick={() => onDeleteExperiment(r.id)}
          style={{ fontSize: 12, height: 22, width: 22, padding: 0 }}
        >✕</Button>
      ),
    },
  ];

  // SHAP 特征重要性排序（取前 5）
  const topFeatures = shapData
    ? shapData.featureNames
        .map((n, i) => ({ name: n, value: Math.abs(shapData.shapValues[i]) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
    : [];

  return (
    <div style={{ padding: 24 }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1a3a5c', margin: 0 }}>
          总览仪表盘
        </h2>
        <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
          实验状态、关键指标与快速导航
        </p>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <Card style={{ borderRadius: 8, borderColor: '#d9e8f5' }}>
            <Statistic
              title="总实验数"
              value={totalExps}
              prefix={<ExperimentOutlined style={{ color: '#2b6fa5' }} />}
              valueStyle={{ color: '#1a3a5c' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card style={{ borderRadius: 8, borderColor: '#d9e8f5' }}>
            <Statistic
              title="已完成"
              value={completedExps}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
              suffix={`/ ${totalExps || '-'}`}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card style={{ borderRadius: 8, borderColor: '#d9e8f5' }}>
            <Statistic
              title="待实验"
              value={pendingExps}
              prefix={<ClockCircleOutlined style={{ color: '#faad14' }} />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card style={{ borderRadius: 8, borderColor: '#d9e8f5' }}>
            <Statistic
              title="LHS / BO"
              value={`${lhsCount} / ${boCount}`}
              prefix={<DatabaseOutlined style={{ color: '#2b6fa5' }} />}
              valueStyle={{ color: '#1a3a5c', fontSize: 22 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 快速导航 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card size="small" title="快速导航" style={{ borderColor: '#d9e8f5' }}>
            <Space wrap>
              <Button icon={<DatabaseOutlined />} onClick={() => onNavigate('lhs')}>
                LHS 生成初始设计 <ArrowRightOutlined />
              </Button>
              <Button icon={<LineChartOutlined />} onClick={() => onNavigate('bo')}>
                BO 优化迭代 <ArrowRightOutlined />
              </Button>
              <Button icon={<PieChartOutlined />} onClick={() => onNavigate('shap')}>
                SHAP 特征分析 <ArrowRightOutlined />
              </Button>
              <Button icon={<ThunderboltOutlined />} onClick={() => onNavigate('bo')}>
                数据池管理 <ArrowRightOutlined />
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 最近实验 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            size="small"
            title="最近实验"
            style={{ borderColor: '#d9e8f5' }}
            extra={
              experiments.length > 0 && (
                <Button type="link" size="small" onClick={() => onNavigate('datapool')}>
                  查看全部
                </Button>
              )
            }
          >
            {recentExps.length === 0 ? (
              <Empty description="暂无实验数据，请先在 LHS 模块生成初始方案" />
            ) : (
              <Table
                dataSource={recentExps}
                columns={expColumns}
                rowKey="id"
                pagination={false}
                size="small"
                scroll={{ x: 500 }}
              />
            )}
          </Card>
        </Col>

        {/* SHAP 特征重要性摘要 */}
        <Col xs={24} lg={10}>
          <Card
            size="small"
            title="特征重要性 (Top 5)"
            style={{ borderColor: '#d9e8f5' }}
            extra={
              shapData && (
                <Button type="link" size="small" onClick={() => onNavigate('shap')}>
                  详细分析
                </Button>
              )
            }
          >
            {topFeatures.length === 0 ? (
              <Empty description="请先在 SHAP 模块执行全局分析" />
            ) : (
              <div>
                {topFeatures.map((f, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>{f.name}</span>
                      <span style={{ color: '#2b6fa5', fontWeight: 600 }}>{f.value.toFixed(4)}</span>
                    </div>
                    <div
                      style={{
                        height: 8,
                        background: '#f0f4f8',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${(f.value / (topFeatures[0]?.value || 1)) * 100}%`,
                          background: 'linear-gradient(90deg, #2b6fa5, #4a9bd9)',
                          borderRadius: 4,
                          transition: 'width 0.3s',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 优化进度概览 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card size="small" title="优化进度" style={{ borderColor: '#d9e8f5' }}>
            <Row gutter={16}>
              <Col span={6}>
                <Statistic
                  title="优化模式"
                  value={boSettings.mode === 'single' ? '单目标' : '多目标'}
                  valueStyle={{ fontSize: 16, color: '#1a3a5c' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="代理模型"
                  value={boSettings.surrogate || 'GP'}
                  valueStyle={{ fontSize: 16, color: '#1a3a5c' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="采集函数"
                  value={boSettings.acquisition}
                  valueStyle={{ fontSize: 16, color: '#1a3a5c' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="探索率"
                  value={`${(boSettings.explorationRate * 100).toFixed(0)}%`}
                  valueStyle={{ fontSize: 16, color: '#1a3a5c' }}
                />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default OverviewPanel;
