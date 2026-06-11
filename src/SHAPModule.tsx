// SHAPModule.tsx - SHAP 可解释性分析模块
import React, { useState, useEffect } from 'react';
import {
  Card, Row, Col, Button, Table, Tag, Space, message, Empty, Descriptions,
  Divider, Progress, Select, Tooltip,
} from 'antd';
import {
  ReloadOutlined, BarChartOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import Plot from 'react-plotly.js';
import type { Experiment, SHAPValues, PartialDependenceData } from './types';

const { Option } = Select;

interface Props {
  shapData: SHAPValues | null;
  experiments: Experiment[];
  onRequestSHAP: () => Promise<SHAPValues | null>;
  onExperimentSelect: (expId: number) => Promise<SHAPValues | null>;
  onDeleteExperiment: (expId: number) => void;
  callAPI: (endpoint: string, method: string, data?: any) => Promise<any>;
  loading: boolean;
}

const SHAPModule: React.FC<Props> = ({
  shapData, experiments, onRequestSHAP, onExperimentSelect, onDeleteExperiment, callAPI, loading,
}) => {
  const [selectedExpId, setSelectedExpId] = useState<number | null>(null);
  const [partialDepData, setPartialDepData] = useState<PartialDependenceData | null>(null);
  const [depFeature, setDepFeature] = useState<string>('');
  const [depColorFeature, setDepColorFeature] = useState<string>('');

  // 选择实验做局部 SHAP
  const handleSelectExperiment = async (id: number) => {
    setSelectedExpId(id);
    const result = await onExperimentSelect(id);
    if (result) message.success('局部 SHAP 分析完成');
  };

  // 全局 SHAP
  const handleGlobalSHAP = async () => {
    const result = await onRequestSHAP();
    if (result) message.success('全局 SHAP 分析完成');
  };

  // 偏依赖图
  const handlePartialDependence = async () => {
    if (!depFeature) { message.warning('请选择特征变量'); return; }
    const payload: any = {
      experiments,
      featureName: depFeature,
    };
    if (depColorFeature) payload.colorFeature = depColorFeature;
    const result = await callAPI('shap/dependence', 'POST', payload);
    if (result && result.data) {
      setPartialDepData(result.data);
      message.success('偏依赖图已生成');
    }
  };

  // 完成状态实验列表
  const completedExps = experiments.filter((e) => e.status === 'completed');

  // 获取所有特征名称
  const featureNames = experiments.length > 0 ? Object.keys(experiments[0].variables) : [];

  // 渲染蜂群图
  const renderBeeswarm = () => {
    if (!shapData) return null;
    const data = [{
      type: 'violin' as const,
      y: shapData.shapValues,
      x: shapData.featureNames,
      box: { visible: true },
      meanline: { visible: true },
      points: 'all',
      pointpos: -1.5,
      jitter: 0.3,
      marker: {
        color: shapData.featureValues,
        colorscale: 'RdBu',
        showscale: true,
        size: 8,
      },
    }];
    return (
      <Plot
        data={data}
        layout={{
          title: 'SHAP 蜂群图 (颜色表示变量取值高低)',
          xaxis: { title: '特征' },
          yaxis: { title: 'SHAP 值 (对输出的影响)' },
          width: 700,
          height: 400,
          margin: { l: 60, r: 40, t: 40, b: 80 },
        }}
        style={{ width: '100%' }}
      />
    );
  };

  // 渲染特征重要性条形图
  const renderFeatureImportance = () => {
    if (!shapData) return null;
    const sortedIndices = shapData.shapValues
      .map((v, i) => ({ v: Math.abs(v), i }))
      .sort((a, b) => b.v - a.v);
    const sortedNames = sortedIndices.map((s) => shapData.featureNames[s.i]);
    const sortedValues = sortedIndices.map((s) => shapData.shapValues[s.i]);

    const data = [{
      type: 'bar' as const,
      x: sortedValues,
      y: sortedNames,
      orientation: 'h' as const,
      marker: {
        color: sortedValues.map((v) => v >= 0 ? '#e74c3c' : '#3498db'),
      },
    }];
    return (
      <Plot
        data={data}
        layout={{
          title: '特征重要性 (SHAP 值)',
          xaxis: { title: '平均 |SHAP 值|' },
          yaxis: { title: '', automargin: true },
          width: 500,
          height: 350,
          margin: { l: 100, r: 20, t: 40, b: 60 },
        }}
        style={{ width: '100%' }}
      />
    );
  };

  // 渲染瀑布图 (局部)
  const renderWaterfall = () => {
    if (!shapData) return null;
    const { featureNames: names, shapValues: vals, baseValue, outputValue } = shapData;
    const sorted = names.map((n, i) => ({ name: n, value: vals[i] }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    let cumulative = baseValue;
    const waterfallData = sorted.map((item) => {
      const start = cumulative;
      cumulative += item.value;
      return { ...item, start, end: cumulative };
    });

    const data = [{
      type: 'waterfall' as const,
      orientation: 'h' as const,
      y: [...waterfallData.map((d) => d.name), '最终'],
      x: [...waterfallData.map((d) => d.value), outputValue - baseValue],
      base: [...waterfallData.map((d) => d.start), baseValue],
      connector: { line: { color: '#bbb' } },
      increasing: { marker: { color: '#e74c3c' } },
      decreasing: { marker: { color: '#3498db' } },
    }];

    return (
      <Plot
        data={data}
        layout={{
          title: 'SHAP 瀑布图 (红色=正向, 蓝色=反向)',
          xaxis: { title: '预测值' },
          width: 600,
          height: 350,
          margin: { l: 100, r: 20, t: 40, b: 60 },
        }}
        style={{ width: '100%' }}
      />
    );
  };

  // 渲染偏依赖散点图
  const renderPartialDependence = () => {
    if (!partialDepData) return null;
    const trace: any = {
      type: 'scatter',
      mode: 'markers',
      x: partialDepData.xValues,
      y: partialDepData.yValues,
      marker: { size: 8, color: '#3498db' },
      name: partialDepData.featureName,
    };
    if (partialDepData.lowerBound && partialDepData.upperBound) {
      trace.error_y = {
        type: 'data',
        symmetric: false,
        array: partialDepData.upperBound.map((u, i) => u - partialDepData.yValues[i]),
        arrayminus: partialDepData.yValues.map((y, i) => y - (partialDepData.lowerBound?.[i] ?? y)),
      };
    }
    return (
      <Plot
        data={[trace]}
        layout={{
          title: `SHAP 偏依赖: ${partialDepData.featureName}`,
          xaxis: { title: partialDepData.featureName },
          yaxis: { title: 'SHAP 值' },
          width: 600,
          height: 380,
          margin: { l: 60, r: 20, t: 40, b: 60 },
        }}
        style={{ width: '100%' }}
      />
    );
  };

  // 表格列 - 实验选择
  const expColumns = [
    {
      title: '标记', key: 'flag', width: 40,
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
    { title: '批次', dataIndex: 'batch', key: 'batch', width: 60 },
    ...(completedExps.length > 0
      ? Object.keys(completedExps[0].variables).map((vname) => ({
        title: vname,
        key: vname,
        width: 90,
        render: (_: any, record: Experiment) => String(record.variables[vname] ?? '-'),
      }))
      : []),
    ...(completedExps.length > 0
      ? Object.keys(completedExps[0].objectives).map((oname) => ({
        title: oname,
        key: oname,
        width: 90,
        render: (_: any, record: Experiment) =>
          record.objectives[oname] != null ? Number(record.objectives[oname]).toFixed(2) : '-',
      }))
      : []),
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_: any, record: Experiment) => (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<BarChartOutlined />}
            onClick={() => handleSelectExperiment(record.id)}
            loading={loading && selectedExpId === record.id}
          >
            分析
          </Button>
          <Button type="text" size="small" danger
            onClick={() => onDeleteExperiment(record.id)}
          >
            ✕
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 标题区 */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1a3a5c', margin: 0 }}>
          SHAP
          <span style={{ fontWeight: 400, fontSize: 14, color: '#666', marginLeft: 12 }}>
            基于代理模型的机器学习可解释性模块
          </span>
        </h2>
        <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>逆向配方解析 — 分析各变量对实验目标的贡献，实现特征重要性与变量间交互效应可视化</p>
      </div>

      {/* 全局分析区 */}
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card
            size="small"
            title={<span style={{ color: '#1a3a5c' }}>全局分析</span>}
            extra={
              <Button icon={<ReloadOutlined />} onClick={handleGlobalSHAP} loading={loading}>
                执行全局 SHAP 分析
              </Button>
            }
            style={{ borderColor: '#d9e8f5' }}
          >
            {shapData ? (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={14}>{renderBeeswarm()}</Col>
                <Col xs={24} lg={10}>{renderFeatureImportance()}</Col>
              </Row>
            ) : (
              <Empty description="点击「执行全局 SHAP 分析」查看特征重要性" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 局部解析区 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={<span style={{ color: '#1a3a5c' }}>局部解析</span>}
            style={{ borderColor: '#d9e8f5' }}
          >
            {completedExps.length === 0 ? (
              <Empty description="暂无已完成实验数据，请先在 BO 模块填写实验结果" />
            ) : (
              <>
                <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
                  点击某行「分析」按钮，自动生成 SHAP 力图
                </p>
                <Table
                  dataSource={completedExps}
                  columns={expColumns}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  scroll={{ x: 500 }}
                />
              </>
            )}
            {shapData && selectedExpId && (
              <div style={{ marginTop: 16 }}>
                <Divider />
                <Descriptions column={2} size="small">
                  <Descriptions.Item label="基准值">{shapData.baseValue.toFixed(2)}</Descriptions.Item>
                  <Descriptions.Item label="预测值">{shapData.outputValue.toFixed(2)}</Descriptions.Item>
                </Descriptions>
                <Divider />
                {shapData.featureNames.map((name, idx) => (
                  <div key={idx} style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 13 }}>{name}: </span>
                    <Progress
                      percent={Math.abs(shapData.shapValues[idx]) / Math.max.apply(null, shapData.shapValues.map(function(v) { return Math.abs(v); }).concat([0.001])) * 100}
                      size="small"
                      status={shapData.shapValues[idx] > 0 ? 'success' : 'exception'}
                      format={() => `${shapData.shapValues[idx] > 0 ? '+' : ''}${shapData.shapValues[idx].toFixed(4)}`}
                      strokeColor={shapData.shapValues[idx] > 0 ? '#e74c3c' : '#3498db'}
                    />
                    <Tag color={shapData.shapValues[idx] > 0 ? 'red' : 'blue'} style={{ marginLeft: 8 }}>
                      {shapData.featureValues[idx].toFixed(2)}
                    </Tag>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={<span style={{ color: '#1a3a5c' }}>瀑布图</span>}
            style={{ borderColor: '#d9e8f5' }}
          >
            {shapData && selectedExpId ? renderWaterfall() : (
              <Empty description="选择实验进行局部 SHAP 分析" />
            )}
          </Card>
        </Col>
      </Row>

      {/* 交互分析区 - 偏依赖 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card
            size="small"
            title={<span style={{ color: '#1a3a5c' }}>交互分析 — SHAP 偏依赖散点图</span>}
            style={{ borderColor: '#d9e8f5' }}
          >
            <Space style={{ marginBottom: 16 }}>
              <span>特征变量:</span>
              <Select value={depFeature} onChange={(v) => setDepFeature(v)} style={{ width: 150 }}
                placeholder="选择变量">
                {featureNames.map((f) => <Option key={f} value={f}>{f}</Option>)}
              </Select>
              <span>颜色映射:</span>
              <Select value={depColorFeature} onChange={(v) => setDepColorFeature(v)} style={{ width: 150 }}
                placeholder="可选" allowClear>
                {featureNames.map((f) => <Option key={f} value={f}>{f}</Option>)}
              </Select>
              <Button type="primary" icon={<ExperimentOutlined />} onClick={handlePartialDependence} loading={loading}>
                生成偏依赖图
              </Button>
            </Space>
            {partialDepData ? renderPartialDependence() : (
              <Empty description="选择变量并点击「生成偏依赖图」查看变量间协同/拮抗效应" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default SHAPModule;
