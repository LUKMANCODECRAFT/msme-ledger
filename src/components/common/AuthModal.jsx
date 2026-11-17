import React, { useState } from 'react';
import Modal from './Modal.jsx';
import Button from './Button.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function AuthModal({ isOpen, onClose }) {
  const { user, isAuthenticated, currentRole, login, register, logout } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);
    try {
      await login(email, password);
      setSuccessMessage('Signed in successfully!');
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      setErrorMessage(err.message || 'Login failed. Please verify your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);
    try {
      await register({
        email,
        password,
        fullName,
        businessName: businessName.trim() || 'My Retail Store'
      });
      setSuccessMessage('Account registered and signed in successfully!');
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      setErrorMessage(err.message || 'Registration failed. Please check your inputs.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogoutClick = async () => {
    setIsSubmitting(true);
    try {
      await logout();
      onClose();
    } catch (err) {
      setErrorMessage(err.message || 'Logout failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isAuthenticated ? 'Account & Session Profile' : 'Merchant Authentication'}
      subtitle={
        isAuthenticated
          ? 'Manage your active cloud identity and role permissions'
          : 'Sign in to sync your store across devices or continue offline'
      }
      maxWidth="md"
    >
      {isAuthenticated ? (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl bg-[#FAF6EE] border border-[#E5DCC5] space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5DCC5]">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#5C6460]">Active Account</p>
                <h4 className="text-base font-black text-[#141816] mt-0.5">{user?.fullName || 'Retail Merchant'}</h4>
                <p className="text-xs text-[#5C6460] font-mono">{user?.email}</p>
              </div>
              <span className="text-2xs font-bold uppercase px-2.5 py-1 rounded-full bg-[#1B4332] text-[#FDFBF7] border border-[#143621]">
                {currentRole}
              </span>
            </div>

            <div className="text-xs space-y-2 text-[#434A46] pt-1">
              <div className="flex justify-between">
                <span className="font-semibold text-[#5C6460]">Session Mode:</span>
                <span className="font-bold text-[#1B4332]">Cloud Authenticated</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-[#5C6460]">Local Device:</span>
                <span className="font-medium text-[#141816]">Encrypted & Synchronized</span>
              </div>
            </div>
          </div>

          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-[#F3EDE0] border border-[#E5DCC5] text-xs font-bold text-[#141816]">
              {errorMessage}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="md"
              className="flex-1"
              onClick={onClose}
            >
              Continue to App
            </Button>
            <Button
              variant="danger"
              size="md"
              isLoading={isSubmitting}
              onClick={handleLogoutClick}
            >
              Sign Out
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Mode Switcher Tabs */}
          <div className="grid grid-cols-2 p-1 rounded-xl bg-[#F3EDE0] border border-[#E5DCC5] text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage('');
                setSuccessMessage('');
              }}
              className={`py-2 rounded-lg transition-colors ${
                mode === 'login'
                  ? 'bg-[#1B4332] text-[#FDFBF7] shadow-xs'
                  : 'text-[#5C6460] hover:text-[#141816]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMessage('');
                setSuccessMessage('');
              }}
              className={`py-2 rounded-lg transition-colors ${
                mode === 'register'
                  ? 'bg-[#1B4332] text-[#FDFBF7] shadow-xs'
                  : 'text-[#5C6460] hover:text-[#141816]'
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Feedback Alerts */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-[#F3EDE0] border border-[#E5DCC5] text-xs font-bold text-[#141816]">
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="p-3.5 rounded-xl bg-[#D8ECE1] border border-[#B2DAC5] text-xs font-bold text-[#1B4332]">
              {successMessage}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#363C39] mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="merchant@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#E5DCC5] rounded-xl text-sm font-medium text-[#141816] focus:outline-none focus:ring-2 focus:ring-[#1B4332] focus:border-[#1B4332]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#363C39] mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#E5DCC5] rounded-xl text-sm font-medium text-[#141816] focus:outline-none focus:ring-2 focus:ring-[#1B4332] focus:border-[#1B4332]"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={isSubmitting}
                className="w-full mt-2"
              >
                Sign In to Your Store
              </Button>
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#363C39] mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ibrahim Danladi"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#E5DCC5] rounded-xl text-sm font-medium text-[#141816] focus:outline-none focus:ring-2 focus:ring-[#1B4332] focus:border-[#1B4332]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#363C39] mb-1.5">
                  Shop / Business Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Al-Baraka Agro Mart"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#E5DCC5] rounded-xl text-sm font-medium text-[#141816] focus:outline-none focus:ring-2 focus:ring-[#1B4332] focus:border-[#1B4332]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#363C39] mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="merchant@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#E5DCC5] rounded-xl text-sm font-medium text-[#141816] focus:outline-none focus:ring-2 focus:ring-[#1B4332] focus:border-[#1B4332]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#363C39] mb-1.5">
                  Password (minimum 8 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#E5DCC5] rounded-xl text-sm font-medium text-[#141816] focus:outline-none focus:ring-2 focus:ring-[#1B4332] focus:border-[#1B4332]"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={isSubmitting}
                className="w-full mt-2"
              >
                Create Account & Register Store
              </Button>
            </form>
          )}

          {/* Offline Clarification Box */}
          <div className="p-4 rounded-2xl bg-[#FDFBF7] border border-[#E5DCC5] text-xs text-[#5C6460] space-y-1">
            <p className="font-bold text-[#141816]">Using Without an Account?</p>
            <p className="leading-relaxed">
              You do not need to sign in to record sales or manage debts. MSME Ledger works 100% offline. Sign in only when you want to back up to the cloud or share access with cashiers.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
