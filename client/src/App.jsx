import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import NewOrder from './pages/NewOrder';
import Tracking from './pages/Tracking';
import Admin from './pages/Admin';
import Driver from './pages/Driver';

function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function Home() {
  const { user } = useAuth();
  return user.role === 'SOFOR' ? <Driver /> : <Dashboard />;
}

const OFFICE = ['ADMIN', 'SATIS', 'DEPO', 'LOJISTIK'];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route element={<ProtectedRoute roles={OFFICE} />}>
            <Route path="orders" element={<Orders />} />
          </Route>
          <Route element={<ProtectedRoute roles={['ADMIN', 'SATIS', 'LOJISTIK']} />}>
            <Route path="tracking" element={<Tracking />} />
          </Route>
          <Route element={<ProtectedRoute roles={['ADMIN']} />}>
            <Route path="admin" element={<Admin />} />
          </Route>
          <Route element={<ProtectedRoute roles={['SATIS', 'ADMIN']} />}>
            <Route path="orders/new" element={<NewOrder />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
