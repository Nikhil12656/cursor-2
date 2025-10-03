const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: '../.env.local' });

// Check if environment variables are loaded
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing Supabase environment variables!');
    console.error('Please create a .env.local file in the project root with:');
    console.error('SUPABASE_URL=your_supabase_project_url');
    console.error('SUPABASE_ANON_KEY=your_supabase_anon_key');
    console.error('SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key');
    console.error('');
    console.error('You can find these values in your Supabase project settings under "API"');
    process.exit(1);
}

const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Initialize Supabase Admin client for server-side operations
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware to protect routes
const requireAuth = async (req, res, next) => {
    const token = req.cookies['auth-token'];

    if (!token) {
        return res.redirect('/login');
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        return res.redirect('/login');
    }

    req.user = user;
    next();
};

// --- PAGE RENDERING ROUTES ---
app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/signup', (req, res) => {
    res.render('signup');
});

app.get('/dashboard', requireAuth, async (req, res) => {
    console.log('📊 Dashboard route hit for user:', req.user.id);
    
    const { data: devices, error } = await supabaseAdmin
        .from('devices')
        .select('*')
        .eq('owner_id', req.user.id);

    console.log('Devices query result:', { data: devices, error });

    if (error) {
        console.error('❌ Error fetching devices:', error);
        return res.status(500).send('Error fetching devices');
    }

    console.log('✅ Devices fetched successfully:', devices);
    res.render('dashboard', {
        user: req.user,
        devices: devices || [],
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    });
});

app.get('/content', requireAuth, async (req, res) => {
    const { data: content, error } = await supabaseAdmin
        .from('content')
        .select('*')
        .eq('owner_id', req.user.id);

    res.render('content', { content: content || [] });
});

app.get('/playlist/:deviceId', requireAuth, async (req, res) => {
    const { deviceId } = req.params;
    const { data: device, error: deviceError } = await supabaseAdmin
        .from('devices')
        .select('*')
        .eq('device_id', deviceId)
        .single();

    const { data: content, error: contentError } = await supabaseAdmin
        .from('content')
        .select('*')
        .eq('owner_id', req.user.id);

    res.render('playlist', { device: device || {}, content: content || [] });
});

app.get('/profile', requireAuth, async (req, res) => {
    res.render('profile', { user: req.user });
});

// Route to test Supabase connection
app.get('/test-supabase', (req, res) => {
    res.render('test-supabase', {
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY
    });
});


// --- API & AUTHENTICATION ROUTES ---

app.post('/signup', async (req, res) => {
    const { email, password, full_name, avatar_url } = req.body;
    
    // Sign up user with metadata
    const { data, error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: {
            data: {
                full_name: full_name || '',
                avatar_url: avatar_url || ''
            }
        }
    });

    if (error) {
        console.error('Supabase Signup Error:', error);
        return res.status(400).json({ error: error.message });
    }

    res.status(200).json({ message: 'Signup successful, please login.' });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        return res.status(400).json({ error: error.message });
    }

    res.cookie('auth-token', data.session.access_token, { httpOnly: true, secure: false, maxAge: 3600000 });
    res.status(200).json({ message: 'Login successful' });
});

// --- DEVICE MANAGEMENT ---

// Generate a unique code for a new device
app.post('/api/generate-code', requireAuth, async (req, res) => {
    console.log('🔧 Generate code endpoint hit');
    console.log('User ID:', req.user.id);
    console.log('Device name:', req.body.device_name);
    
    // Generate a random 8-character hexadecimal string
    const unique_code = crypto.randomBytes(4).toString('hex').toUpperCase();
    console.log('Generated code:', unique_code);

    try {
        const { data, error } = await supabaseAdmin
            .from('devices')
            .insert([{
                owner_id: req.user.id, 
                unique_code: unique_code,
                device_name: req.body.device_name || 'New Device'
            }])
            .select();

        console.log('Insert result:', { data, error });

        if (error) {
            console.error('❌ Database error:', error);
            return res.status(500).json({ error: error.message });
        }

        console.log('✅ Device created successfully:', data[0]);
        res.status(201).json(data[0]);
    } catch (err) {
        console.error('❌ Unexpected error:', err);
        res.status(500).json({ error: 'Unexpected error occurred' });
    }
});

// Confirm a device's activation
app.post('/api/confirm-device', async (req, res) => {
    const { device_id } = req.body;

    const { data, error } = await supabaseAdmin
        .from('devices')
        .update({ status: 'active' })
        .eq('device_id', device_id)
        .select();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(200).json(data[0]);
});

// --- CONTENT MANAGEMENT (SKELETON) ---

// Upload content metadata
app.post('/api/content', requireAuth, async (req, res) => {
    // This is a placeholder for file upload logic.
    const { file_url, content_type } = req.body;

    const { data, error } = await supabaseAdmin
        .from('content')
        .insert([{ 
            owner_id: req.user.id, 
            file_url, 
            content_type 
        }])
        .select();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(201).json(data[0]);
});

// --- USER PROFILE MANAGEMENT ---

// Get user profile
app.get('/api/user/profile', requireAuth, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', req.user.id)
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(200).json(data);
});

// Update user profile
app.put('/api/user/profile', requireAuth, async (req, res) => {
    const { full_name, avatar_url } = req.body;

    // Update the users table
    const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .update({ 
            full_name: full_name || req.user.user_metadata?.full_name || '',
            avatar_url: avatar_url || req.user.user_metadata?.avatar_url || ''
        })
        .eq('id', req.user.id)
        .select();

    if (userError) {
        return res.status(500).json({ error: userError.message });
    }

    // Also update the auth user metadata
    const { error: authError } = await supabase.auth.updateUser({
        data: {
            full_name: full_name || req.user.user_metadata?.full_name || '',
            avatar_url: avatar_url || req.user.user_metadata?.avatar_url || ''
        }
    });

    if (authError) {
        console.error('Auth update error:', authError);
        // Don't fail the request if auth update fails, user table is updated
    }

    res.status(200).json(userData[0]);
});

// --- PLAYLIST MANAGEMENT (SKELETON) ---

// Create or update a playlist for a device
app.post('/api/playlist', requireAuth, async (req, res) => {
    const { device_id, content_id, start_time, end_time, order } = req.body;

    const { data, error } = await supabaseAdmin
        .from('playlists')
        .insert([{ 
            device_id, 
            content_id, 
            start_time, 
            end_time, 
            order 
        }])
        .select();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(201).json(data[0]);
});

app.listen(port, () => {
    console.log(`CMS server listening at http://localhost:${port}`);
});
