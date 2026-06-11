// DataUploadModal.tsx - XLSX 数据上传与分析模态框
import React, { useState, useRef } from 'react';
import {
  Modal, Upload, Button, Table, Tag, message, Spin, Divider, Checkbox, Typography, Space,
} from 'antd';
import {
  InboxOutlined, UploadOutlined, CheckCircleFilled, CloseCircleFilled,
  LineChartOutlined,
} from '@ant-design/icons';
import type { Experiment, UploadColumn, UploadPreview } from './types';
import type { UploadFile } from 'antd';

const { Dragger } = Upload;
const { Text, Title } = Typography;

// 列类型颜色映射
const typeColors: Record<string, string> = {
  continuous: '#4a9bd9',
  categorical: '#52c41a',
  discrete: '#f39c12',
};

const typeLabels: Record<string, string> = {
  continuous: '连续型',
  categorical: '分类型',
  discrete: '离散型',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  callAPI: (endpoint: string, method: string, data?: any, isFormData?: boolean) => Promise<any>;
  onImportSuccess: (exps: Experiment[]) => void;
  onNavigate?: (tab: string) => void;
}

const DataUploadModal: React.FC<Props> = ({ visible, onClose, callAPI, onImportSuccess, onNavigate }) => {
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [varCols, setVarCols] = useState<string[]>([]);
  const [objCols, setObjCols] = useState<string[]>([]);
  const [importDone, setImportDone] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  // 重置状态
  const reset = () => {
    setPreview(null);
    setUploadFile(null);
    setVarCols([]);
    setObjCols([]);
    setImportDone(false);
    setImportedCount(0);
  };

  // 处理文件上传
  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadFile(file);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await callAPI('data/upload', 'POST', formData, true);
      if (result && result.success && result.data) {
        setPreview(result.data as UploadPreview);
        // 默认：字符串列归分类变量，数值列归连续变量
        const cols = result.data.columns as UploadColumn[];
        setVarCols(cols.map((c) => c.name));
        setObjCols(cols.filter((c) => c.type === 'continuous').map((c) => c.name));
        message.success(`成功解析 ${result.data.sheetName}（${result.data.totalRows} 行 × ${result.data.totalCols} 列）`);
      } else {
        message.error('文件解析失败，请检查格式');
      }
    } catch (e) {
      message.error('上传失败，请检查后端服务');
    } finally {
      setUploading(false);
    }
  };

  // 导入实验
  const handleImport = async () => {
    if (!preview || varCols.length === 0) return;
    setImporting(true);
    try {
      const result = await callAPI('data/import', 'POST', {
        rows: preview.rows,
        varNames: varCols,
        objNames: objCols,
      });
      if (result && result.success && result.data) {
        onImportSuccess(result.data);
        const count = result.data.length;
        message.success(`成功导入 ${count} 条实验记录`);
        setImportedCount(count);
        setImportDone(true);
      } else {
        message.error('数据导入失败');
      }
    } catch (e) {
      message.error('导入请求失败');
    } finally {
      setImporting(false);
    }
  };

  // 表格列定义
  const tableColumns = preview
    ? [
        { title: '#', dataIndex: '_idx', key: '_idx', width: 50, render: (_: any, __: any, i: number) => i + 1 },
        ...preview.columns.map((col) => ({
          title: (
            <span>
              {col.name}
              <Tag
                style={{
                  marginLeft: 4, fontSize: 10, lineHeight: '16px', height: 18,
                  background: `${typeColors[col.type]}22`,
                  borderColor: typeColors[col.type],
                  color: typeColors[col.type],
                }}
              >
                {typeLabels[col.type]}
              </Tag>
            </span>
          ),
          dataIndex: col.name,
          key: col.name,
          width: 120,
          render: (val: any) => {
            if (val === null || val === undefined || val === '') return <span style={{ color: '#555' }}>—</span>;
            if (typeof val === 'number') return <span style={{ color: '#e0e0e0' }}>{val}</span>;
            return <span style={{ color: '#52c41a' }}>{String(val)}</span>;
          },
        })),
      ]
    : [];

  return (
    <Modal
      title={
        <span style={{ color: '#e0e0e0', fontSize: 15, fontWeight: 600 }}>
          <UploadOutlined style={{ marginRight: 8 }} />
          XLSX 数据上传与分析
        </span>
      }
      open={visible}
      onCancel={() => { reset(); onClose(); }}
      width={900}
      style={{ top: 20 }}
      styles={{
        body: {
          background: '#0d0d0d',
          maxHeight: 'calc(100vh - 120px)',
          overflowY: 'auto',
        },
        mask: { background: 'rgba(0,0,0,0.7)' },
        content: { background: '#141414', border: '1px solid #2a2a2a' },
        header: { background: '#141414', borderBottom: '1px solid #2a2a2a', padding: '16px 24px', borderRadius: '8px 8px 0 0' },
        footer: { borderTop: '1px solid #2a2a2a', padding: '12px 24px' },
      }}
      footer={
        preview && !importDone ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <span style={{ color: '#888', fontSize: 12 }}>
                已选变量: {varCols.length} 列 | 目标: {objCols.length} 列
              </span>
              {varCols.length > 0 && (
                <Button
                  type="primary"
                  onClick={handleImport}
                  loading={importing}
                  style={{
                    background: '#52c41a', borderColor: '#52c41a', borderRadius: 6, fontSize: 12,
                  }}
                >
                  导入实验
                </Button>
              )}
            </Space>
            <Button onClick={() => { reset(); onClose(); }} style={{ borderRadius: 6, fontSize: 12, background: '#1a1a1a', borderColor: '#333', color: '#ccc' }}>
              取消
            </Button>
          </div>
        ) : null
      }
    >
      {/* ---- 上传区域 ---- */}
      {!preview && (
        <Dragger
          accept=".xlsx,.xls"
          showUploadList={false}
          beforeUpload={(file) => {
            handleUpload(file);
            return false; // 阻止默认上传
          }}
          style={{
            background: '#0d0d0d',
            border: '2px dashed #333',
            borderRadius: 8,
            padding: 24,
          }}
        >
          <p style={{ fontSize: 40, color: '#555', margin: 0 }}>
            <InboxOutlined />
          </p>
          <p style={{ color: '#e0e0e0', fontSize: 14, margin: '8px 0' }}>
            点击或拖拽 XLSX 文件到此处
          </p>
          <p style={{ color: '#888', fontSize: 12 }}>
            支持 .xlsx 和 .xls 格式的工作表文件
          </p>
        </Dragger>
      )}

      {uploading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
          <div style={{ color: '#888', marginTop: 12 }}>正在解析文件...</div>
        </div>
      )}

      {/* ---- 导入成功 ---- */}
      {importDone && (
        <div style={{ textAlign: 'center', padding: '30px 20px' }}>
          <div style={{ fontSize: 48, color: '#52c41a', marginBottom: 12 }}>
            <CheckCircleFilled />
          </div>
          <div style={{ color: '#e0e0e0', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            数据导入成功
          </div>
          <div style={{ color: '#888', fontSize: 13, marginBottom: 4 }}>
            已导入 {importedCount} 条实验记录
          </div>
          <div style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
            变量列: {varCols.join('、')}
            {objCols.length > 0 && <span> | 目标列: {objCols.join('、')}</span>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <Button
              type="primary"
              icon={<LineChartOutlined />}
              onClick={() => {
                reset();
                onClose();
                onNavigate?.('bo');
              }}
              style={{
                background: '#4a9bd9', borderColor: '#4a9bd9',
                borderRadius: 6, fontSize: 13, height: 36,
              }}
            >
              前往 BO 生成下一轮预测
            </Button>
            <Button
              onClick={() => { reset(); onClose(); }}
              style={{
                borderRadius: 6, fontSize: 13, height: 36,
                background: '#1a1a1a', borderColor: '#333', color: '#ccc',
              }}
            >
              继续上传
            </Button>
          </div>
        </div>
      )}

      {/* ---- 预览数据 ---- */}
      {preview && !uploading && !importDone && (
        <div>
          {/* 文件信息 */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px', background: '#0a0a0a', borderRadius: 6, marginBottom: 12,
            border: '1px solid #222',
          }}>
            <div>
              <span style={{ color: '#ccc', fontSize: 13, fontWeight: 600 }}>{uploadFile?.name}</span>
              <span style={{ color: '#888', fontSize: 11, marginLeft: 12 }}>
                工作表: {preview.sheetName}
              </span>
            </div>
            <div style={{ color: '#888', fontSize: 12 }}>
              共 {preview.totalRows} 行 × {preview.totalCols} 列
              {preview.totalRows > 200 && (
                <span style={{ color: '#faad14', marginLeft: 8 }}>（预览前 200 行）</span>
              )}
            </div>
          </div>

          {/* 列统计 */}
          <div style={{ marginBottom: 12 }}>
            <Text style={{ color: '#ccc', fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'block' }}>
              列统计（勾选变量 / 目标列）：
            </Text>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #222' }}>
                  <th style={{ padding: '4px 6px', color: '#888', textAlign: 'left', width: 30 }}>变量</th>
                  <th style={{ padding: '4px 6px', color: '#888', textAlign: 'left', width: 30 }}>目标</th>
                  <th style={{ padding: '4px 6px', color: '#888', textAlign: 'left' }}>列名</th>
                  <th style={{ padding: '4px 6px', color: '#888', textAlign: 'left', width: 60 }}>类型</th>
                  <th style={{ padding: '4px 6px', color: '#888', textAlign: 'right', width: 50 }}>非空</th>
                  <th style={{ padding: '4px 6px', color: '#888', textAlign: 'right', width: 50 }}>缺失</th>
                  <th style={{ padding: '4px 6px', color: '#888', textAlign: 'right', width: 50 }}>唯一值</th>
                  <th style={{ padding: '4px 6px', color: '#888', textAlign: 'left', width: 80 }}>范围/选项</th>
                </tr>
              </thead>
              <tbody>
                {preview.columns.map((col) => (
                  <tr key={col.name} style={{ borderBottom: '1px solid #181818' }}>
                    <td style={{ padding: '3px 6px' }}>
                      <Checkbox
                        checked={varCols.includes(col.name)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setVarCols([...varCols, col.name]);
                          } else {
                            setVarCols(varCols.filter((c) => c !== col.name));
                          }
                        }}
                        style={{ color: '#ccc' }}
                      />
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      <Checkbox
                        checked={objCols.includes(col.name)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setObjCols([...objCols, col.name]);
                          } else {
                            setObjCols(objCols.filter((c) => c !== col.name));
                          }
                        }}
                        style={{ color: '#ccc' }}
                      />
                    </td>
                    <td style={{ padding: '3px 6px', color: '#ccc', fontWeight: 500 }}>{col.name}</td>
                    <td style={{ padding: '3px 6px' }}>
                      <Tag style={{
                        fontSize: 10, lineHeight: '16px', height: 18,
                        background: `${typeColors[col.type]}22`,
                        borderColor: typeColors[col.type],
                        color: typeColors[col.type],
                      }}>
                        {typeLabels[col.type]}
                      </Tag>
                    </td>
                    <td style={{ padding: '3px 6px', color: '#ccc', textAlign: 'right' }}>{col.count}</td>
                    <td style={{ padding: '3px 6px', color: col.missing > 0 ? '#faad14' : '#555', textAlign: 'right' }}>
                      {col.missing || '-'}
                    </td>
                    <td style={{ padding: '3px 6px', color: '#ccc', textAlign: 'right' }}>{col.unique}</td>
                    <td style={{ padding: '3px 6px', color: '#888', fontSize: 10, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {col.type === 'categorical' && col.options
                        ? col.options.slice(0, 3).join(', ') + (col.options.length > 3 ? '...' : '')
                        : col.min !== null && col.max !== null
                          ? `${col.min?.toFixed(2)} ~ ${col.max?.toFixed(2)}`
                          : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Divider style={{ borderColor: '#222', margin: '8px 0 12px' }} />

          {/* 数据预览表格 */}
          <Text style={{ color: '#ccc', fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'block' }}>
            数据预览（{preview.rows.length} 行）：
          </Text>
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #222', borderRadius: 6 }}>
            <Table
              dataSource={preview.rows}
              columns={tableColumns}
              rowKey={(_, i) => String(i)}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content', y: 220 }}
              style={{ background: '#0a0a0a' }}
              locale={{ emptyText: <span style={{ color: '#555' }}>无数据</span> }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
};

export default DataUploadModal;
