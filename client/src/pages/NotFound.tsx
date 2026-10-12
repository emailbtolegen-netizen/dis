import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NotFound({ forbidden }: { forbidden?: boolean }) {
  const nav = useNavigate();
  return (
    <Result
      status={forbidden ? '403' : '404'}
      title={forbidden ? 'Нет доступа' : 'Страница не найдена'}
      subTitle={forbidden ? 'Для этого раздела у вашей роли недостаточно прав. Обратитесь к администратору.' : 'Проверьте адрес страницы.'}
      extra={<Button type="primary" onClick={() => nav('/')}>На главную</Button>}
    />
  );
}
