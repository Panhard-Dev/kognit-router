import './DataTable.css'

export default function DataTable({ data }) {
  const columns = ['ID', 'Tipo', 'Status', 'Latência', 'Throughput']
  const keys = ['id', 'type', 'status', 'latency', 'throughput']

  return (
    <div className="data-table">
      <h3 className="data-table__title">Fluxos Ativos</h3>
      <div className="data-table__wrapper">
        <table className="data-table__table">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={i}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i}>
                {keys.map((key, j) => (
                  <td key={j} className={key === 'status' ? `status--${row[key].toLowerCase()}` : ''}>
                    {row[key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
